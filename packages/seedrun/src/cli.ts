// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
import { spawn } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { availableParallelism } from "node:os"
import { dirname, extname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"

import { findConfig, loadConfig, type LoadedConfig } from "./config.ts"
import { computePart, mergeParts, partialPath, runPart } from "./run.ts"

export const USAGE = `seedrun: reproducible experiments with fixed seeds, run in parts and merged into one file.

Usage:
  seedrun list                       the parts in the config, with their seeds
  seedrun run <part...>              run these parts and write out/<part>.json for each
  seedrun run --all                  run every part
  seedrun merge                      combine the partial files into results.json
  seedrun verify <part...> | --all   run each part twice and check the bytes match (and match out/ if present)

Options:
  -c, --config <file>   config file (default: seedrun.config.ts, .mts, .mjs or .js in this folder)
  -j, --jobs <n>        parts to run side by side, each in its own process (default: one per core, at most one per part)
      --out <dir>       partial files directory (default: from the config, "out" next to it)
      --results <file>  merged results file (default: from the config, "results.json" next to it)
  -h, --help            this help`

/** Where the CLI writes. Tests pass their own. */
export interface CliIo {
  stdout(line: string): void
  stderr(line: string): void
  cwd: string
}

const defaultIo: CliIo = {
  stdout: (line) => process.stdout.write(line + "\n"),
  stderr: (line) => process.stderr.write(line + "\n"),
  cwd: process.cwd(),
}

/** Runs the CLI with the given arguments (without `node` and the script) and returns the exit code. */
export async function main(argv: readonly string[], io: CliIo = defaultIo): Promise<number> {
  let args
  try {
    args = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        config: { type: "string", short: "c" },
        jobs: { type: "string", short: "j" },
        out: { type: "string" },
        results: { type: "string" },
        all: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    })
  } catch (err) {
    io.stderr(`${(err as Error).message}\n\n${USAGE}`)
    return 2
  }
  const { values, positionals } = args
  const [command, ...names] = positionals
  if (values.help || command === undefined || command === "help") {
    io.stdout(USAGE)
    return values.help || command === "help" ? 0 : 2
  }
  try {
    const loaded = await loadConfig(values.config !== undefined ? resolve(io.cwd, values.config) : findConfig(io.cwd))
    const cfg: LoadedConfig = {
      ...loaded,
      outDir: values.out !== undefined ? resolve(io.cwd, values.out) : loaded.outDir,
      resultsFile: values.results !== undefined ? resolve(io.cwd, values.results) : loaded.resultsFile,
    }
    const show = (path: string) => {
      const rel = relative(io.cwd, path)
      return rel === "" ? "." : rel.startsWith("..") ? path : rel
    }
    const pick = (): string[] => {
      if (values.all) return cfg.experiment.parts.map((p) => p.name)
      if (names.length === 0) throw new UsageError(`name the parts to ${command} (or pass --all); parts: ${cfg.experiment.parts.map((p) => p.name).join(", ")}`)
      for (const n of names) if (!cfg.experiment.parts.some((p) => p.name === n)) {
        throw new UsageError(`no part "${n}"; parts: ${cfg.experiment.parts.map((p) => p.name).join(", ")}`)
      }
      return [...new Set(names)]
    }

    switch (command) {
      case "list": {
        const e = cfg.experiment
        io.stdout(`${e.name}  seed ${e.seed}${e.version !== undefined ? `  version ${e.version}` : ""}`)
        const width = Math.max(...e.parts.map((p) => p.name.length))
        for (const p of e.parts) {
          const done = existsSync(partialPath(cfg.outDir, p.name)) ? "done" : "    "
          io.stdout(`  ${p.name.padEnd(width)}  seed ${String(p.seed).padStart(10)}  ${done}  ${p.description ?? ""}`.trimEnd())
        }
        return 0
      }
      case "run": {
        const parts = pick()
        const jobs = parseJobs(values.jobs, parts.length)
        if (jobs > 1) return await runSideBySide(cfg, parts, jobs, io)
        for (const name of parts) {
          const r = await runPart(cfg.experiment, name, { outDir: cfg.outDir, log: io.stderr })
          io.stdout(`${name}: wrote ${show(r.file)} in ${r.seconds.toFixed(2)} s (sha256 ${r.sha256.slice(0, 12)})`)
        }
        return 0
      }
      case "merge": {
        const m = await mergeParts(cfg.experiment, { outDir: cfg.outDir, resultsFile: cfg.resultsFile })
        io.stdout(`merged ${cfg.experiment.parts.length} parts into ${show(cfg.resultsFile)} (sha256 ${m.sha256.slice(0, 12)})`)
        return 0
      }
      case "verify": {
        let ok = true
        for (const name of pick()) {
          const a = await computePart(cfg.experiment, name, { log: () => {} })
          const b = await computePart(cfg.experiment, name, { log: () => {} })
          if (a.json !== b.json) {
            ok = false
            io.stdout(`${name}: DIFFERENT between two runs in one process; something in the part is not seeded`)
            continue
          }
          const file = partialPath(cfg.outDir, name)
          const saved = existsSync(file) ? readFileSync(file, "utf8") : undefined
          if (saved === undefined) io.stdout(`${name}: same bytes twice (sha256 ${a.sha256.slice(0, 12)}); no saved file to compare`)
          else if (saved === a.json) io.stdout(`${name}: same bytes twice, and same as ${show(file)} (sha256 ${a.sha256.slice(0, 12)})`)
          else {
            ok = false
            io.stdout(`${name}: repeatable, but DIFFERENT from ${show(file)}; the code, the config or the Node version changed since it was written`)
          }
        }
        return ok ? 0 : 1
      }
      default:
        throw new UsageError(`unknown command "${command}"`)
    }
  } catch (err) {
    if (err instanceof UsageError) {
      io.stderr(`${err.message}\n\n${USAGE}`)
      return 2
    }
    io.stderr(`seedrun: ${(err as Error).message}`)
    return 1
  }
}

class UsageError extends Error {}

function parseJobs(value: string | undefined, parts: number): number {
  if (value === undefined) return Math.max(1, Math.min(parts, availableParallelism()))
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1) throw new UsageError(`--jobs must be a whole number of 1 or more, got "${value}"`)
  return Math.min(n, parts)
}

/** Runs each part in its own Node process, `jobs` at a time. Processes keep parts from sharing memory or globals. */
async function runSideBySide(cfg: LoadedConfig, parts: readonly string[], jobs: number, io: CliIo): Promise<number> {
  const here = fileURLToPath(import.meta.url)
  const bin = join(dirname(here), `bin${extname(here)}`)
  const queue = [...parts]
  const failed: string[] = []
  io.stderr(`running ${parts.length} parts, ${jobs} side by side`)
  const worker = async (): Promise<void> => {
    for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
      const code = await new Promise<number>((done) => {
        const child = spawn(
          process.execPath,
          [bin, "run", name, "--jobs", "1", "--config", cfg.file, "--out", cfg.outDir, "--results", cfg.resultsFile],
          { cwd: io.cwd, stdio: ["ignore", "pipe", "pipe"] },
        )
        const pass = (stream: NodeJS.ReadableStream, to: (line: string) => void) => {
          let buf = ""
          stream.setEncoding("utf8")
          stream.on("data", (chunk: string) => {
            buf += chunk
            const lines = buf.split(/\r?\n/)
            buf = lines.pop() ?? ""
            for (const line of lines) to(line)
          })
          stream.on("end", () => buf && to(buf))
        }
        pass(child.stdout, io.stdout)
        pass(child.stderr, io.stderr)
        child.on("error", (err) => {
          io.stderr(`[${name}] could not start: ${err.message}`)
          done(1)
        })
        child.on("close", (c) => done(c ?? 1))
      })
      if (code !== 0) failed.push(name)
    }
  }
  await Promise.all(Array.from({ length: jobs }, worker))
  if (failed.length > 0) {
    io.stderr(`failed: ${failed.join(", ")}`)
    return 1
  }
  return 0
}
