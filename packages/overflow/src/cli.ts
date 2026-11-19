// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
import { readFileSync, statSync } from "node:fs"
import { resolve } from "node:path"
import { parseArgs } from "node:util"

import { check, fails } from "./check.ts"
import { bookmarklet, collectorExpression } from "./collector.ts"
import { parseConfig, resolveConfig, SEVERITIES } from "./config.ts"
import { formatMarkdown, formatText } from "./format.ts"
import { InputError, parseSnapshot } from "./snapshot.ts"
import type { Report, ResolvedConfig } from "./types.ts"

export const USAGE = `overflow: audit a page snapshot for inner scrollbars, sideways page scroll, misaligned columns, wrapping titles and clipped text.

Usage:
  overflow check <snapshot.json...>   check one or more snapshots (one per viewport, say)
  overflow collector                  print the in-page collector as a JavaScript expression
  overflow collector --bookmarklet    print it as a javascript: bookmark that downloads the snapshot

Options:
  -c, --config <file>      JSON config (tolerances, ignore and allowScroll selectors, rule severities)
      --fail-on <level>    exit 1 when a finding is at or above: info, warning (default), error, never
  -f, --format <format>    text (default), markdown or json
      --label <name>       viewport label for reports (check) or the snapshot (collector)
  -h, --help               this help

Exit codes: 0 no findings at or above --fail-on, 1 there are, 2 a usage mistake or a bad snapshot or config.`

/** Snapshots larger than this are refused before reading (a 20,000-element snapshot is about 10 MB). */
export const MAX_FILE_BYTES = 100 * 1024 * 1024

export interface CliIo {
  stdout(text: string): void
  stderr(text: string): void
  cwd: string
}

const defaultIo: CliIo = {
  stdout: (t) => process.stdout.write(t + "\n"),
  stderr: (t) => process.stderr.write(t + "\n"),
  cwd: process.cwd(),
}

class UsageError extends Error {}

function readText(path: string, what: string): string {
  let size: number
  try {
    size = statSync(path).size
  } catch {
    throw new InputError("", `cannot read ${what} ${path}: no such file`)
  }
  if (size > MAX_FILE_BYTES) throw new InputError("", `${what} ${path} is ${Math.round(size / 1048576)} MB; the limit is ${MAX_FILE_BYTES / 1048576} MB`)
  return readFileSync(path, "utf8").replace(/^﻿/, "")
}

/** Runs the CLI with the given arguments (without `node` and the script) and returns the exit code. */
export function main(argv: readonly string[], io: CliIo = defaultIo): number {
  let args
  try {
    args = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        config: { type: "string", short: "c" },
        "fail-on": { type: "string" },
        format: { type: "string", short: "f" },
        label: { type: "string" },
        bookmarklet: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    })
  } catch (err) {
    io.stderr(`${(err as Error).message}\n\n${USAGE}`)
    return 2
  }
  const { values, positionals } = args
  const [command, ...files] = positionals
  if (values.help || command === undefined || command === "help") {
    io.stdout(USAGE)
    return values.help || command === "help" ? 0 : 2
  }
  try {
    switch (command) {
      case "collector": {
        if (files.length > 0) throw new UsageError(`collector takes no files`)
        const opts = values.label !== undefined ? { label: values.label } : {}
        io.stdout(values.bookmarklet ? bookmarklet(opts) : collectorExpression(opts))
        return 0
      }
      case "check": {
        if (files.length === 0) throw new UsageError("name at least one snapshot file")
        const format = values.format ?? "text"
        if (format !== "text" && format !== "markdown" && format !== "json") throw new UsageError(`--format must be text, markdown or json, got "${format}"`)
        let cfg: ResolvedConfig
        if (values.config !== undefined) {
          const path = resolve(io.cwd, values.config)
          try {
            cfg = parseConfig(readText(path, "config"))
          } catch (err) {
            throw new InputError("", `config ${values.config}: ${(err as Error).message}`)
          }
        } else cfg = resolveConfig({})
        if (values.label !== undefined) cfg.viewportLabel = values.label
        const failOn = values["fail-on"] ?? cfg.failOn
        if (failOn !== "never" && !(SEVERITIES as readonly string[]).includes(failOn)) {
          throw new UsageError(`--fail-on must be info, warning, error or never, got "${failOn}"`)
        }
        const reports: Report[] = files.map((f) => {
          try {
            return check(parseSnapshot(readText(resolve(io.cwd, f), "snapshot")), cfg)
          } catch (err) {
            throw new InputError("", `${f}: ${(err as Error).message}`)
          }
        })
        if (format === "json") io.stdout(JSON.stringify(reports.length === 1 ? reports[0] : reports, null, 2))
        else io.stdout(reports.map(format === "markdown" ? formatMarkdown : formatText).join("\n\n"))
        return reports.some((r) => fails(r, failOn as typeof cfg.failOn)) ? 1 : 0
      }
      default:
        throw new UsageError(`unknown command "${command}"`)
    }
  } catch (err) {
    if (err instanceof UsageError) {
      io.stderr(`${err.message}\n\n${USAGE}`)
      return 2
    }
    if (err instanceof InputError) {
      io.stderr(`overflow: ${err.message}`)
      return 2
    }
    io.stderr(`overflow: ${(err as Error).message}`)
    return 2
  }
}
