// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// The claim checker: runs the active rules over text or files and returns findings with file, line and column.
import { readdirSync, readFileSync, statSync } from "node:fs"
import { extname, join, relative, resolve, sep } from "node:path"

import { DEFAULT_EXTENSIONS, DEFAULT_IGNORE, resolveRules, type ActiveRule, type HonestConfig } from "./config.ts"
import { Document } from "./document.ts"
import type { ClaimRule, Severity } from "./rules.ts"

export interface Finding {
  rule: string
  severity: Severity
  file: string
  line: number
  column: number
  /** The text that matched (empty for whole-file rules). */
  match: string
  message: string
  hint?: string
}

export interface CheckOptions {
  config?: HonestConfig
  /** Rules to add to the built-ins, for library users. */
  rules?: readonly ClaimRule[]
}

/** File types read as prose; everything else is read as code, where each line ends a sentence. */
const PROSE = new Set([".md", ".mdx", ".markdown", ".txt", ".rst", ".tex", ".html", ".htm"])

function run(doc: Document, active: readonly ActiveRule[]): Finding[] {
  const findings: Finding[] = []
  for (const { rule, severity, options } of active) {
    if (doc.isFileIgnored(rule.id)) continue
    for (const hit of rule.check(doc, options)) {
      const { line, column } = doc.position(hit.index)
      if (doc.isIgnored(line, rule.id)) continue
      const f: Finding = { rule: rule.id, severity, file: doc.file, line, column, match: doc.text.slice(hit.index, hit.index + hit.length), message: hit.message }
      if (hit.hint !== undefined) f.hint = hit.hint
      findings.push(f)
    }
  }
  return findings.sort((a, b) => a.line - b.line || a.column - b.column || a.rule.localeCompare(b.rule))
}

/**
 * Checks a string. `file` names it in findings and picks prose or code sentence splitting by its extension
 * (default prose).
 */
export function checkText(text: string, opts: CheckOptions & { file?: string } = {}): Finding[] {
  const file = opts.file ?? "<text>"
  const mode = opts.file === undefined || PROSE.has(extname(file).toLowerCase()) ? "prose" : "code"
  return run(new Document(text, file, mode), resolveRules(opts.config, opts.rules))
}

/** Turns a simple glob into a regular expression: `*` within a segment, `**` across segments, `?` one character. */
export function globToRegExp(glob: string): RegExp {
  let re = ""
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] as string
    if (c === "*" && glob[i + 1] === "*") {
      const slash = glob[i + 2] === "/"
      re += slash ? "(?:.*/)?" : ".*"
      i += slash ? 2 : 1
    } else if (c === "*") re += "[^/]*"
    else if (c === "?") re += "[^/]"
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&")
  }
  // A pattern without a slash matches a name at any depth, like .gitignore.
  return glob.includes("/") ? new RegExp(`^${re}(?:/.*)?$`) : new RegExp(`(?:^|/)${re}(?:/.*)?$`)
}

export interface PathsResult {
  findings: Finding[]
  /** Files read, relative to `cwd`, in scan order. */
  files: string[]
}

/**
 * Checks files and directories. Directories are walked, reading files with the configured extensions and skipping
 * ignored paths; files named directly are always read. Paths in findings are relative to `cwd`, with forward slashes.
 */
export function checkPaths(paths: readonly string[], opts: CheckOptions & { cwd?: string } = {}): PathsResult {
  const cwd = opts.cwd ?? process.cwd()
  const active = resolveRules(opts.config, opts.rules)
  const extensions = new Set((opts.config?.extensions ?? DEFAULT_EXTENSIONS).map((e) => e.toLowerCase()))
  const ignore = [...DEFAULT_IGNORE, ...(opts.config?.ignore ?? [])].map(globToRegExp)
  const rel = (abs: string): string => relative(cwd, abs).split(sep).join("/") || "."
  const ignored = (abs: string): boolean => {
    const r = rel(abs)
    return r !== "." && ignore.some((re) => re.test(r))
  }
  const files: string[] = []
  const walk = (abs: string, named: boolean): void => {
    const st = statSync(abs)
    if (st.isDirectory()) {
      if (!named && ignored(abs)) return
      for (const name of readdirSync(abs).sort()) walk(join(abs, name), false)
    } else if (st.isFile()) {
      if (!named && (ignored(abs) || !extensions.has(extname(abs).toLowerCase()))) return
      files.push(abs)
    }
  }
  for (const p of paths) walk(resolve(cwd, p), true)

  const findings: Finding[] = []
  for (const abs of [...new Set(files)]) {
    const text = readFileSync(abs, "utf8")
    if (text.includes("\u0000")) continue // binary
    const file = rel(abs)
    const mode = PROSE.has(extname(abs).toLowerCase()) ? "prose" : "code"
    findings.push(...run(new Document(text, file, mode), active))
  }
  return { findings, files: [...new Set(files)].map(rel) }
}
