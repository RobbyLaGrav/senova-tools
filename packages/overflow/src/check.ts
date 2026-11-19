// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Runs every rule over a snapshot and builds the report.
import { resolveConfig } from "./config.ts"
import { Context, RULES } from "./rules.ts"
import { validateSnapshot } from "./snapshot.ts"
import { RULE_IDS, type Config, type Finding, type Report, type ResolvedConfig, type Severity } from "./types.ts"

const RANK: Record<Severity, number> = { info: 0, warning: 1, error: 2 }

/** True when `severity` is at or above `threshold`. */
export function atLeast(severity: Severity, threshold: Severity): boolean {
  return RANK[severity] >= RANK[threshold]
}

const isResolved = (c: unknown): c is ResolvedConfig =>
  typeof c === "object" && c !== null && Array.isArray((c as ResolvedConfig).ignore) && typeof (c as ResolvedConfig).tolerance?.column === "number" &&
  typeof (c as ResolvedConfig).rules === "object" && RULE_IDS.every((r) => r in (c as ResolvedConfig).rules)

/**
 * Checks a snapshot. `snapshot` is validated first (it may come straight from `JSON.parse`); `config` may be a
 * partial `Config` or a `ResolvedConfig`. Findings are ordered by severity (errors first), then page order.
 */
export function check(snapshot: unknown, config: Config | ResolvedConfig = {}): Report {
  const snap = validateSnapshot(snapshot)
  const cfg = isResolved(config) ? config : resolveConfig(config)
  const ctx = new Context(snap, cfg)
  const raw = RULES.flatMap((rule) => rule(ctx))
  const ruleOrder = (r: string) => (RULE_IDS as readonly string[]).indexOf(r)
  raw.sort((a, b) => RANK[b.severity] - RANK[a.severity] || a.index - b.index || ruleOrder(a.rule) - ruleOrder(b.rule))
  const findings: Finding[] = raw.map(({ index: _index, ...f }) => f)
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 }
  for (const f of findings) counts[f.severity]++
  const label = cfg.viewportLabel ?? snap.viewport.label
  return {
    overflow: 1,
    ...(snap.url !== undefined ? { url: snap.url } : {}),
    viewport: { width: snap.viewport.width, height: snap.viewport.height, ...(label !== undefined ? { label } : {}) },
    truncated: snap.truncated === true,
    elements: snap.elements.length,
    counts,
    findings,
  }
}

/** Does the report have a finding at or above `failOn`? `never` is always false. */
export function fails(report: Report, failOn: Severity | "never"): boolean {
  return failOn !== "never" && report.findings.some((f) => atLeast(f.severity, failOn))
}
