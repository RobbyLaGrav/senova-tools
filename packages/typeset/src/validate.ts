// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Check every equation on a site in one go, for tests and CI. Unlike renderEquation it never throws: it renders each
// snippet and reports exactly which ones failed and why, so one run lists every broken equation, not just the first.
import { renderEquation, TypesetError, type RenderOptions } from "./render.ts"

/** A snippet to check: bare TeX, or TeX with an id (a page and equation name, say) that shows up in the report. */
export type Snippet = string | { readonly id: string; readonly tex: string; readonly display?: boolean }

/** One snippet that failed. */
export interface ValidationFailure {
  /** Position of the snippet in the list passed to {@link validateAll}. */
  readonly index: number
  /** The snippet's id, when it had one. */
  readonly id: string | undefined
  readonly tex: string
  /** KaTeX's reason, for example "Undefined control sequence: \\fracc". */
  readonly message: string
  /** Character offset into `tex` where rendering stopped, if known. */
  readonly position: number | undefined
}

/** The result of {@link validateAll}. */
export interface ValidationReport {
  /** True when every snippet rendered. */
  readonly ok: boolean
  /** How many snippets were checked. */
  readonly checked: number
  /** The snippets that failed, in list order. Empty when `ok` is true. */
  readonly failures: readonly ValidationFailure[]
}

/** Renders every snippet with the same strict settings as {@link renderEquation} and reports the ones that fail. */
export function validateAll(snippets: readonly Snippet[], opts: Pick<RenderOptions, "macros"> = {}): ValidationReport {
  const failures: ValidationFailure[] = []
  snippets.forEach((s, index) => {
    const { id, tex, display } = typeof s === "string" ? { id: undefined, tex: s, display: true } : s
    try {
      renderEquation(tex, { ...opts, display: display ?? true })
    } catch (err) {
      const e = err instanceof TypesetError ? err : new TypesetError(tex, String(err))
      failures.push({ index, id, tex, message: e.reason, position: e.position })
    }
  })
  return { ok: failures.length === 0, checked: snippets.length, failures }
}

/** Formats a report as plain text, one line per failure, for CI logs. */
export function formatReport(report: ValidationReport): string {
  if (report.ok) return `Typeset: all ${report.checked} equations render.`
  const lines = report.failures.map((f) => {
    const where = f.id ?? `#${f.index}`
    const at = f.position === undefined ? "" : ` (at character ${f.position})`
    return `  ${where}: ${f.message}${at}\n    ${f.tex}`
  })
  return `Typeset: ${report.failures.length} of ${report.checked} equations failed:\n${lines.join("\n")}`
}
