// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Plain-text and Markdown views of a report. JSON is the report itself (`JSON.stringify(report, null, 2)`).
import type { Report } from "./types.ts"

function heading(r: Report): string {
  const vp = `${r.viewport.width}x${r.viewport.height}${r.viewport.label ? ` (${r.viewport.label})` : ""}`
  return `${r.url ?? "snapshot"} at ${vp}`
}

function summary(r: Report): string {
  const { error, warning, info } = r.counts
  if (r.findings.length === 0) return `no findings in ${r.elements} elements`
  return `${error} error${error === 1 ? "" : "s"}, ${warning} warning${warning === 1 ? "" : "s"}, ${info} info in ${r.elements} elements`
}

const TRUNCATED = "the collector stopped at its element limit, so elements after it were not checked"

/** One block per finding, for terminals and logs. */
export function formatText(report: Report): string {
  const lines = [`${heading(report)}: ${summary(report)}`]
  if (report.truncated) lines.push(`note: ${TRUNCATED}`)
  for (const f of report.findings) {
    lines.push("", `${f.severity.toUpperCase().padEnd(7)} ${f.rule}  ${f.selector}`, `        ${f.message}`)
    if (f.hint) lines.push(`        fix: ${f.hint}`)
  }
  return lines.join("\n")
}

const cell = (s: string) => s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
const code = (s: string) => {
  const ticks = s.includes("`") ? "``" : "`"
  return `${ticks}${ticks === "``" ? " " : ""}${cell(s)}${ticks === "``" ? " " : ""}${ticks}`
}

/** A Markdown section with a table, for pull request comments and issue reports. */
export function formatMarkdown(report: Report): string {
  const lines = [`### Overflow: ${cell(heading(report))}`, "", `${summary(report)}.`]
  if (report.truncated) lines.push("", `Note: ${TRUNCATED}.`)
  if (report.findings.length > 0) {
    lines.push("", "| Severity | Rule | Element | Finding |", "| --- | --- | --- | --- |")
    for (const f of report.findings) lines.push(`| ${f.severity} | ${f.rule} | ${code(f.selector)} | ${cell(f.message)} |`)
  }
  return lines.join("\n")
}
