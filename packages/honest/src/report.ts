// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Report formats for findings: readable text, JSON for tools, and GitHub Actions annotations.
import type { Finding } from "./check.ts"

export type ReportFormat = "text" | "json" | "github"

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`

/** "2 errors and 1 warning in 3 files" (or "No findings in 3 files"). */
export function summarize(findings: readonly Finding[], fileCount: number): string {
  const errors = findings.filter((f) => f.severity === "error").length
  const warnings = findings.length - errors
  const where = `in ${plural(fileCount, "file")}`
  if (!findings.length) return `No findings ${where}.`
  return `${plural(errors, "error")} and ${plural(warnings, "warning")} ${where}.`
}

/** Formats findings for people, tools or GitHub Actions. */
export function formatFindings(findings: readonly Finding[], format: ReportFormat, fileCount: number): string {
  if (format === "json") {
    const errors = findings.filter((f) => f.severity === "error").length
    return JSON.stringify({ files: fileCount, errors, warnings: findings.length - errors, findings }, null, 2)
  }
  if (format === "github") {
    // https://docs.github.com/actions/reference/workflow-commands-for-github-actions
    const esc = (v: string): string => v.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")
    const prop = (v: string): string => esc(v).replaceAll(":", "%3A").replaceAll(",", "%2C")
    const lines = findings.map((f) => {
      const level = f.severity === "error" ? "error" : "warning"
      const body = f.hint ? `${f.message} ${f.hint}` : f.message
      return `::${level} file=${prop(f.file)},line=${f.line},col=${f.column},title=${prop(`honest/${f.rule}`)}::${esc(body)}`
    })
    return [...lines, summarize(findings, fileCount)].join("\n")
  }
  const lines: string[] = []
  for (const f of findings) {
    lines.push(`${f.file}:${f.line}:${f.column}  ${f.severity === "error" ? "error" : "warn "}  ${f.rule}  ${f.message}`)
    if (f.hint) lines.push(`    ${f.hint}`)
  }
  lines.push(summarize(findings, fileCount))
  return lines.join("\n")
}
