// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Turns a run into what CI and reviewers read: JUnit XML for the test tab, and a Markdown report for the pull request
// with a comparison against the base branch and one Mermaid line chart per measurement. Console text comes from the
// device, so everything taken from a run is escaped for the place it lands.
import type { BenchRun, Measurement, TestResult, TestStatus } from "./results.ts"

export type DiffStatus = "new" | "same" | "changed" | "out-of-limits"

export interface MeasurementDiff {
  test: string
  name: string
  unit?: string
  value: number
  min?: number
  max?: number
  baseline?: number
  /** value - baseline. */
  delta?: number
  status: DiffStatus
}

export interface CompareOptions {
  /** Relative change counted as `changed`. Default 0.02 (2%). */
  tolerance?: number
}

export interface MarkdownOptions extends CompareOptions {
  baseline?: BenchRun
  /** Earlier runs, oldest first. The last 20 are charted with this one. */
  history?: readonly BenchRun[]
  title?: string
}

const key = (test: string, name: string) => `${test}\u0000${name}`

function lastByKey(run: BenchRun): Map<string, { test: TestResult; m: Measurement }> {
  const map = new Map<string, { test: TestResult; m: Measurement }>()
  // A measurement taken more than once in a test is compared by its last reading.
  for (const test of run.tests) for (const m of test.measurements) map.set(key(test.name, m.name), { test, m })
  return map
}

export function compareRuns(run: BenchRun, baseline?: BenchRun, options: CompareOptions = {}): MeasurementDiff[] {
  const tolerance = options.tolerance ?? 0.02
  const base = baseline ? lastByKey(baseline) : new Map()
  const out: MeasurementDiff[] = []
  for (const [k, { test, m }] of lastByKey(run)) {
    const d: MeasurementDiff = { test: test.name, name: m.name, value: m.value, status: "same" }
    if (m.unit !== undefined) d.unit = m.unit
    if (m.min !== undefined) d.min = m.min
    if (m.max !== undefined) d.max = m.max
    const b = base.get(k)?.m.value
    if (b === undefined || !Number.isFinite(b)) d.status = "new"
    else {
      d.baseline = b
      d.delta = m.value - b
      const scale = Math.max(Math.abs(b), 1e-9)
      if (!Number.isFinite(d.delta) || Math.abs(d.delta) / scale > tolerance) d.status = "changed"
    }
    if (!m.ok) d.status = "out-of-limits"
    out.push(d)
  }
  return out
}

// ---------- JUnit ----------

function xml(text: string): string {
  // XML 1.0 cannot carry most control characters at all, even escaped; device output sometimes has them.
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "\uFFFD")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

const seconds = (ms: number) => (ms / 1000).toFixed(3)

export function toJunit(run: BenchRun): string {
  const count = (s: TestStatus) => run.tests.filter((t) => t.status === s).length
  const failures = count("fail")
  const errors = count("error") + count("timeout")
  const lines = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<testsuites name="bench" tests="${run.tests.length}" failures="${failures}" errors="${errors}" time="${seconds(run.durationMs)}">`,
    `  <testsuite name="${xml(run.board)}" tests="${run.tests.length}" failures="${failures}" errors="${errors}" skipped="${count("skip")}" time="${seconds(run.durationMs)}" timestamp="${xml(run.startedAt)}">`,
  ]
  for (const t of run.tests) {
    lines.push(`    <testcase classname="${xml(run.board)}" name="${xml(t.name)}" time="${seconds(t.durationMs)}">`)
    if (t.measurements.length) {
      lines.push(`      <properties>`)
      for (const m of t.measurements) lines.push(`        <property name="${xml(m.name)}" value="${xml(formatValue(m.value, m.unit))}"/>`)
      lines.push(`      </properties>`)
    }
    const detail = xml([t.message ?? "", ...t.consoleTail].filter(Boolean).join("\n"))
    if (t.status === "fail") lines.push(`      <failure message="${xml(t.message ?? "failed")}">${detail}</failure>`)
    else if (t.status === "error" || t.status === "timeout") lines.push(`      <error type="${t.status}" message="${xml(t.message ?? t.status)}">${detail}</error>`)
    else if (t.status === "skip") lines.push(`      <skipped message="${xml(t.message ?? "skipped")}"/>`)
    if (t.notes.length) lines.push(`      <system-out>${xml(t.notes.join("\n"))}</system-out>`)
    lines.push(`    </testcase>`)
  }
  lines.push(`  </testsuite>`, `</testsuites>`, ``)
  return lines.join("\n")
}

// ---------- Markdown ----------

/** Escapes text for a Markdown table cell: no line breaks, pipes, or inline HTML and formatting. */
export function cell(text: string): string {
  return text
    .replace(/[\r\n]+/g, " ")
    .replace(/[\\`*_[\]<>|~#]/g, (c) => `\\${c}`)
    .trim()
}

/** A fenced code block whose fence is longer than any backtick run inside, so the content can't close it early. */
export function fence(text: string, info = ""): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length))
  const ticks = "`".repeat(Math.max(3, longest + 1))
  return `${ticks}${info}\n${text}\n${ticks}`
}

function formatNumber(v: number): string {
  if (!Number.isFinite(v)) return String(v)
  if (v !== 0 && (Math.abs(v) >= 1e6 || Math.abs(v) < 1e-3)) return v.toExponential(3)
  return String(Number(v.toPrecision(5)))
}

function formatValue(v: number, unit?: string): string {
  return unit ? `${formatNumber(v)} ${unit}` : formatNumber(v)
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
}

const STATUS_WORD: Record<TestStatus, string> = { pass: "pass", fail: "FAIL", error: "ERROR", timeout: "TIMEOUT", skip: "skip" }

function limits(d: { min?: number; max?: number; unit?: string }): string {
  if (d.min === undefined && d.max === undefined) return ""
  const u = d.unit ? ` ${d.unit}` : ""
  if (d.min !== undefined && d.max !== undefined) return `${formatNumber(d.min)} to ${formatNumber(d.max)}${u}`
  return d.min !== undefined ? `at least ${formatNumber(d.min)}${u}` : `at most ${formatNumber(d.max as number)}${u}`
}

function runLabel(run: BenchRun, i: number): string {
  return (run.meta.commit?.slice(0, 7) || run.startedAt.slice(5, 16).replace("T", " ") || `run ${i + 1}`).replace(/["\\]/g, "")
}

/** Text inside a Mermaid quoted string: no quotes, backslashes or line breaks. */
function mermaidText(text: string): string {
  return text.replace(/["\\\r\n`]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80)
}

function chart(name: string, unit: string | undefined, points: { label: string; value: number }[]): string | undefined {
  const finite = points.filter((p) => Number.isFinite(p.value))
  if (finite.length < 2) return undefined
  const values = finite.map((p) => p.value)
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const pad = (hi - lo) * 0.1 || Math.abs(hi) * 0.01 || 1
  const yName = mermaidText(unit ?? "value")
  const lines = [
    "xychart-beta",
    `  title "${mermaidText(unit ? `${name} (${unit})` : name)}"`,
    `  x-axis [${finite.map((p) => `"${mermaidText(p.label)}"`).join(", ")}]`,
    `  y-axis "${yName}" ${formatNumber(lo - pad)} --> ${formatNumber(hi + pad)}`,
    `  line [${values.map((v) => formatNumber(v)).join(", ")}]`,
  ]
  return fence(lines.join("\n"), "mermaid")
}

export function toMarkdown(run: BenchRun, options: MarkdownOptions = {}): string {
  const total = run.tests.length
  const ran = run.tests.filter((t) => t.status !== "skip").length
  const passed = run.tests.filter((t) => t.status === "pass").length
  const commit = run.meta.commit ? `, commit ${cell(run.meta.commit.slice(0, 12))}` : ""
  const verdict = run.passed ? "passed" : "FAILED"
  const out: string[] = []
  out.push(`### ${cell(options.title ?? `Bench on ${run.board}`)}: ${verdict}`)
  out.push("")
  out.push(`${passed}/${ran} passed${ran < total ? ` (${total - ran} skipped)` : ""} in ${formatDuration(run.durationMs)}${commit}${run.image ? `, image ${cell(run.image)}` : ""}.`)
  out.push("")
  out.push("| Test | Result | Time |", "| --- | --- | --- |")
  for (const t of run.tests) out.push(`| ${cell(t.name)} | ${STATUS_WORD[t.status]} | ${formatDuration(t.durationMs)} |`)

  const diffs = compareRuns(run, options.baseline, options.tolerance !== undefined ? { tolerance: options.tolerance } : {})
  if (diffs.length) {
    out.push("", "#### Measurements", "")
    const hasBase = options.baseline !== undefined
    out.push(hasBase ? "| Test | Measurement | Value | Limits | Base | Change | |" : "| Test | Measurement | Value | Limits | |")
    out.push(hasBase ? "| --- | --- | --- | --- | --- | --- | --- |" : "| --- | --- | --- | --- | --- |")
    for (const d of diffs) {
      const flag = d.status === "out-of-limits" ? "**out of limits**" : d.status === "changed" ? "changed" : d.status === "new" && hasBase ? "new" : ""
      const row = [cell(d.test), cell(d.name), cell(formatValue(d.value, d.unit)), cell(limits(d))]
      if (hasBase) {
        const change = d.delta === undefined ? "" : `${d.delta >= 0 ? "+" : ""}${formatNumber(d.delta)}${d.baseline ? ` (${d.delta >= 0 ? "+" : ""}${((d.delta / Math.abs(d.baseline)) * 100).toFixed(1)}%)` : ""}`
        row.push(d.baseline === undefined ? "" : cell(formatValue(d.baseline, d.unit)), cell(change))
      }
      row.push(flag)
      out.push(`| ${row.join(" | ")} |`)
    }

    const history = (options.history ?? []).slice(-20)
    if (history.length) {
      const runs = [...history, run]
      const charts: string[] = []
      for (const d of diffs) {
        const points = runs.map((r, i) => ({ label: runLabel(r, i), value: lastByKey(r).get(key(d.test, d.name))?.m.value ?? Number.NaN }))
        const c = chart(`${d.test}: ${d.name}`, d.unit, points)
        if (c) charts.push(c)
      }
      if (charts.length) out.push("", `#### Trend over the last ${runs.length} runs`, "", charts.join("\n\n"))
    }
  }

  const notPassed = run.tests.filter((t) => t.status !== "pass" && t.status !== "skip")
  for (const t of notPassed) {
    out.push("", `<details><summary>${cell(t.name)}: ${STATUS_WORD[t.status]}</summary>`, "")
    if (t.message) out.push(fence(t.message), "")
    if (t.consoleTail.length) out.push(`Last ${t.consoleTail.length} console lines:`, "", fence(t.consoleTail.join("\n")), "")
    out.push("</details>")
  }
  out.push("")
  return out.join("\n")
}
