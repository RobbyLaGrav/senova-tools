// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { parseArgs } from "node:util"

import type { Board } from "./board.ts"
import { BenchError } from "./errors.ts"
import { acquireBoardLock } from "./lock.ts"
import { toJunit, toMarkdown } from "./report.ts"
import { parseRun, stringifyRun, type BenchRun, type RunMeta } from "./results.ts"
import { runBench, type BenchTest } from "./runner.ts"

export const USAGE = `bench: hardware-in-the-loop tests with results for CI and the pull request.

Usage:
  bench run <config.ts>          lock the board, flash, run the tests, write results
  bench report <results.json>    write the JUnit and Markdown files again from saved results

Options:
      --out <dir>             where to write bench-results.json, junit.xml, bench-report.md (default bench-out)
      --baseline <file>       results from the base branch, for the comparison column
      --history <dir>         a folder of earlier results (*.json), for the trend charts
      --lock-wait <seconds>   run: wait this long for a board in use by another job (default 0)
      --lock-dir <dir>        run: folder for board lock files (default the system temp folder)
      --image <path>          run: firmware image, overriding the config
  -h, --help                  this help

Exit codes: 0 all tests passed, 1 a test did not pass, 2 bad input or the board was locked.`

/** The default export of a config file. */
export interface BenchConfig {
  board: Board
  tests: BenchTest[]
  image?: string
  timeoutMs?: number
  resetBetween?: boolean
  meta?: RunMeta
}

export interface CliIo {
  stdout(line: string): void
  stderr(line: string): void
  cwd: string
  env: Record<string, string | undefined>
}

const defaultIo: CliIo = {
  stdout: (line) => process.stdout.write(line + "\n"),
  stderr: (line) => process.stderr.write(line + "\n"),
  cwd: process.cwd(),
  env: process.env,
}

async function readRun(path: string): Promise<BenchRun> {
  let text: string
  try {
    text = await readFile(path, "utf8")
  } catch (err) {
    throw new BenchError("BAD_RESULTS", `cannot read ${path}: ${(err as Error).message}`)
  }
  try {
    return parseRun(text)
  } catch (err) {
    throw new BenchError("BAD_RESULTS", `${path}: ${(err as Error).message}`)
  }
}

/** Earlier runs from a folder, oldest first by start time. Files that aren't valid results are skipped and named. */
async function readHistory(dir: string, io: CliIo): Promise<BenchRun[]> {
  let names: string[]
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith(".json"))
  } catch (err) {
    throw new BenchError("BAD_RESULTS", `cannot read history folder ${dir}: ${(err as Error).message}`)
  }
  const runs: BenchRun[] = []
  for (const n of names) {
    try {
      runs.push(await readRun(join(dir, n)))
    } catch (err) {
      io.stderr(`skipping history file: ${(err as Error).message}`)
    }
  }
  return runs.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
}

function checkConfig(v: unknown, path: string): BenchConfig {
  const c = (v as { default?: unknown })?.default
  const ok = c && typeof c === "object" && "board" in c && "tests" in c && Array.isArray((c as BenchConfig).tests)
  if (!ok) throw new BenchError("INVALID_ARGUMENT", `${path} must have a default export of { board, tests }`)
  return c as BenchConfig
}

async function writeOutputs(dir: string, run: BenchRun, md: string, withResults: boolean): Promise<void> {
  await mkdir(dir, { recursive: true })
  if (withResults) await writeFile(join(dir, "bench-results.json"), stringifyRun(run))
  await writeFile(join(dir, "junit.xml"), toJunit(run))
  await writeFile(join(dir, "bench-report.md"), md)
}

/** Runs the command with the given arguments (without `node` and the script) and returns the exit code. */
export async function main(argv: readonly string[], io: CliIo = defaultIo, signal?: AbortSignal): Promise<number> {
  let args
  try {
    args = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        out: { type: "string" },
        baseline: { type: "string" },
        history: { type: "string" },
        "lock-wait": { type: "string" },
        "lock-dir": { type: "string" },
        image: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    })
  } catch (err) {
    io.stderr(`${(err as Error).message}\n\n${USAGE}`)
    return 2
  }
  const { values: v, positionals } = args
  const [command, target, ...extra] = positionals
  if (v.help || command === undefined || command === "help") {
    io.stdout(USAGE)
    return v.help || command === "help" ? 0 : 2
  }
  if (command !== "run" && command !== "report") {
    io.stderr(`unknown command "${command}"\n\n${USAGE}`)
    return 2
  }
  if (target === undefined || extra.length) {
    io.stderr(`bench ${command} takes exactly one file\n\n${USAGE}`)
    return 2
  }
  const out = resolve(io.cwd, v.out ?? "bench-out")

  try {
    const baseline = v.baseline ? await readRun(resolve(io.cwd, v.baseline)) : undefined
    const history = v.history ? await readHistory(resolve(io.cwd, v.history), io) : undefined
    const mdOptions = { ...(baseline ? { baseline } : {}), ...(history ? { history } : {}) }

    if (command === "report") {
      const run = await readRun(resolve(io.cwd, target))
      await writeOutputs(out, run, toMarkdown(run, mdOptions), false)
      io.stdout(`wrote ${join(out, "junit.xml")} and ${join(out, "bench-report.md")}`)
      return run.passed ? 0 : 1
    }

    const lockWait = Number(v["lock-wait"] ?? 0)
    if (!(lockWait >= 0)) throw new BenchError("INVALID_ARGUMENT", "--lock-wait must be a number of seconds")
    const configPath = resolve(io.cwd, target)
    let mod: unknown
    try {
      mod = await import(pathToFileURL(configPath).href)
    } catch (err) {
      throw new BenchError("INVALID_ARGUMENT", `cannot load ${configPath}: ${(err as Error).message}`)
    }
    const config = checkConfig(mod, configPath)
    const meta: RunMeta = {}
    const commit = io.env.GITHUB_SHA
    const branch = io.env.GITHUB_HEAD_REF || io.env.GITHUB_REF_NAME
    if (commit) meta.commit = commit
    if (branch) meta.branch = branch
    Object.assign(meta, config.meta)

    const release = await acquireBoardLock(config.board.name, { waitMs: lockWait * 1000, ...(v["lock-dir"] ? { dir: resolve(io.cwd, v["lock-dir"]) } : {}) })
    let run: BenchRun
    try {
      const image = v.image ?? config.image
      run = await runBench({
        board: config.board,
        tests: config.tests,
        meta,
        ...(image !== undefined ? { image } : {}),
        ...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
        ...(config.resetBetween !== undefined ? { resetBetween: config.resetBetween } : {}),
        ...(signal ? { signal } : {}),
        onEvent: (e) => {
          if (e.type === "test-end") io.stdout(`${e.result.status.padEnd(7)} ${e.result.name}${e.result.message ? `: ${e.result.message}` : ""}`)
        },
      })
    } finally {
      await config.board.close().catch(() => {})
      await release()
    }
    await writeOutputs(out, run, toMarkdown(run, mdOptions), true)
    io.stdout(`${run.passed ? "passed" : "FAILED"}; results in ${out}`)
    return run.passed ? 0 : 1
  } catch (err) {
    io.stderr(err instanceof Error ? err.message : String(err))
    return 2
  }
}
