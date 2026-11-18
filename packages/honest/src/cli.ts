// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// The `honest` command line. `run()` takes its arguments and output streams as parameters and returns the exit
// code, so tests call it directly; bin.ts wires it to the process.
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { parseArgs } from "node:util"

import { checkPaths, checkText } from "./check.ts"
import { ConfigError, findConfig, loadConfig, resolveRules, type HonestConfig } from "./config.ts"
import { BUILTIN_RULES } from "./rules.ts"
import { formatFindings, type ReportFormat } from "./report.ts"

/** Exit codes, stable for CI. */
export const EXIT = {
  /** No errors, and warnings within --max-warnings. */
  ok: 0,
  /** Errors found, or more warnings than --max-warnings. */
  findings: 1,
  /** Bad arguments, bad config, or a file that couldn't be read. */
  usage: 2,
} as const

export interface CliIO {
  stdout: (text: string) => void
  stderr: (text: string) => void
  cwd: string
  /** Reads standard input, for `honest check -`. */
  stdin?: () => string
}

const HELP = `Usage: honest <command> [options]

Commands:
  check [paths...]     Scan files and folders for overclaiming (default: the current folder).
                       Use "-" to read standard input.
  rules                List the rules, their default severity and what they look for.

Options for check:
  -c, --config <file>      Config file (default: ./honest.config.json when present)
  -f, --format <format>    text (default), json or github
      --max-warnings <n>   Fail when there are more than n warnings (default: no limit)
  -q, --quiet              Report errors only

  -h, --help               Show this help
  -v, --version            Show the version

Exit codes: 0 clean, 1 findings that fail the run, 2 usage or config error.
Silence one finding with a comment: honest-ignore-line <rule> -- reason
`

function version(): string {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }
  return pkg.version
}

/** Runs the CLI and returns the exit code. */
export function run(argv: readonly string[], io: CliIO): number {
  let parsed
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        config: { type: "string", short: "c" },
        format: { type: "string", short: "f", default: "text" },
        "max-warnings": { type: "string" },
        quiet: { type: "boolean", short: "q", default: false },
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
      },
    })
  } catch (err) {
    io.stderr(`${(err as Error).message}\n\n${HELP}`)
    return EXIT.usage
  }
  const { values, positionals } = parsed
  if (values.version) {
    io.stdout(`${version()}\n`)
    return EXIT.ok
  }
  const [command, ...rest] = positionals
  if (values.help || command === undefined || command === "help") {
    io.stdout(HELP)
    return command === undefined && !values.help ? EXIT.usage : EXIT.ok
  }

  try {
    const config: HonestConfig = values.config ? loadConfig(resolve(io.cwd, values.config)) : findConfig(io.cwd).config
    if (command === "rules") {
      const active = new Map(resolveRules(config).map((a) => [a.rule.id, a.severity]))
      const all = [...BUILTIN_RULES, ...(config.custom ?? []).map((c) => ({ id: c.id, summary: c.message }))]
      const lines = all.map((r) => `${r.id.padEnd(18)}${(active.get(r.id) ?? "off").padEnd(7)}${r.summary}`)
      io.stdout(`${lines.join("\n")}\n`)
      return EXIT.ok
    }
    if (command !== "check") {
      io.stderr(`Unknown command "${command}".\n\n${HELP}`)
      return EXIT.usage
    }
    const format = values.format as ReportFormat
    if (!["text", "json", "github"].includes(format)) {
      io.stderr(`--format must be text, json or github, got "${format}"\n`)
      return EXIT.usage
    }
    let maxWarnings = Infinity
    if (values["max-warnings"] !== undefined) {
      maxWarnings = Number(values["max-warnings"])
      if (!Number.isInteger(maxWarnings) || maxWarnings < 0) {
        io.stderr(`--max-warnings must be a whole number of 0 or more, got "${values["max-warnings"]}"\n`)
        return EXIT.usage
      }
    }

    let findings
    let fileCount
    if (rest.length === 1 && rest[0] === "-") {
      if (!io.stdin) throw new ConfigError("standard input is not available")
      findings = checkText(io.stdin(), { config, file: "<stdin>" })
      fileCount = 1
    } else {
      const r = checkPaths(rest.length ? rest : ["."], { config, cwd: io.cwd })
      findings = r.findings
      fileCount = r.files.length
    }
    if (values.quiet) findings = findings.filter((f) => f.severity === "error")
    io.stdout(`${formatFindings(findings, format, fileCount)}\n`)
    const errors = findings.filter((f) => f.severity === "error").length
    const warnings = findings.length - errors
    if (errors > 0) return EXIT.findings
    if (warnings > maxWarnings) {
      io.stderr(`${warnings} warnings is more than --max-warnings ${maxWarnings}.\n`)
      return EXIT.findings
    }
    return EXIT.ok
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    io.stderr(`honest: ${e.code === "ENOENT" ? `no such file or folder: ${e.path ?? ""}` : e.message}\n`)
    return EXIT.usage
  }
}
