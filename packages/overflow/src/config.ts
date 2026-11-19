// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Config defaults and validation. Unknown keys are refused, so a typo like "tolerence" fails loudly instead of
// leaving the default in place.
import { parseSelector } from "./selector.ts"
import { InputError } from "./snapshot.ts"
import { RULE_IDS, type Config, type ResolvedConfig, type RuleId, type Severity } from "./types.ts"

export const SEVERITIES: readonly Severity[] = ["info", "warning", "error"]

/** Default severity of each rule. Some findings are downgraded case by case (see the README's rule table). */
export const DEFAULT_RULES: Readonly<Record<RuleId, Severity>> = {
  "inner-scrollbar": "warning",
  "page-overflow-x": "error",
  "column-misaligned": "warning",
  "title-wraps": "warning",
  "title-widow": "info",
  "text-clipped": "warning",
}

export const DEFAULT_CONFIG: Readonly<ResolvedConfig> = Object.freeze({
  viewportLabel: undefined,
  ignore: [],
  allowScroll: ["textarea", "select"],
  titleSelectors: [],
  maxTitleLines: 2,
  tolerance: { column: 2, overflow: 1, page: 1 },
  maxCulprits: 5,
  minRows: 3,
  rules: { ...DEFAULT_RULES },
  failOn: "warning",
})

const TOP_KEYS = new Set(["viewportLabel", "ignore", "allowScroll", "titleSelectors", "maxTitleLines", "tolerance", "maxCulprits", "minRows", "rules", "failOn", "$schema"])

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

function selectors(v: unknown, path: string): string[] {
  if (!Array.isArray(v)) throw new InputError(path, "must be an array of CSS selectors")
  return v.map((s, i) => {
    if (typeof s !== "string") throw new InputError(`${path}[${i}]`, "must be a string")
    try {
      parseSelector(s)
    } catch (err) {
      throw new InputError(`${path}[${i}]`, (err as Error).message)
    }
    return s
  })
}

function count(v: unknown, path: string, min: number): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min) throw new InputError(path, `must be a whole number of ${min} or more`)
  return v
}

function px(v: unknown, path: string): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw new InputError(path, "must be a number of pixels, 0 or more")
  return v
}

function severity(v: unknown, path: string, extra: string): Severity {
  if (typeof v !== "string" || !(SEVERITIES as readonly string[]).includes(v) && v !== extra) {
    throw new InputError(path, `must be one of ${[...SEVERITIES, extra].join(", ")}`)
  }
  return v as Severity
}

/** Validates a config object (from JSON or code) and fills in defaults. Throws `InputError` naming the bad field. */
export function resolveConfig(config: unknown = {}): ResolvedConfig {
  if (!isObject(config)) throw new InputError("", "a config must be a JSON object")
  for (const k of Object.keys(config)) if (!TOP_KEYS.has(k)) throw new InputError(k, `is not a config field (fields: ${[...TOP_KEYS].filter((x) => x !== "$schema").join(", ")})`)
  const c = config as Config
  const d = DEFAULT_CONFIG
  const out: ResolvedConfig = {
    viewportLabel: d.viewportLabel,
    ignore: [...d.ignore],
    allowScroll: [...d.allowScroll],
    titleSelectors: [...d.titleSelectors],
    maxTitleLines: d.maxTitleLines,
    tolerance: { ...d.tolerance },
    maxCulprits: d.maxCulprits,
    minRows: d.minRows,
    rules: { ...d.rules },
    failOn: d.failOn,
  }
  if (c.viewportLabel !== undefined) {
    if (typeof c.viewportLabel !== "string") throw new InputError("viewportLabel", "must be a string")
    out.viewportLabel = c.viewportLabel
  }
  if (c.ignore !== undefined) out.ignore = selectors(c.ignore, "ignore")
  if (c.allowScroll !== undefined) out.allowScroll = selectors(c.allowScroll, "allowScroll")
  if (c.titleSelectors !== undefined) out.titleSelectors = selectors(c.titleSelectors, "titleSelectors")
  if (c.maxTitleLines !== undefined) out.maxTitleLines = count(c.maxTitleLines, "maxTitleLines", 1)
  if (c.maxCulprits !== undefined) out.maxCulprits = count(c.maxCulprits, "maxCulprits", 1)
  if (c.minRows !== undefined) out.minRows = count(c.minRows, "minRows", 2)
  if (c.tolerance !== undefined) {
    if (!isObject(c.tolerance)) throw new InputError("tolerance", "must be an object with column, overflow and page")
    for (const [k, v] of Object.entries(c.tolerance)) {
      if (k !== "column" && k !== "overflow" && k !== "page") throw new InputError(`tolerance.${k}`, "is not a tolerance (column, overflow, page)")
      out.tolerance[k] = px(v, `tolerance.${k}`)
    }
  }
  if (c.rules !== undefined) {
    if (!isObject(c.rules)) throw new InputError("rules", "must be an object of rule: severity")
    for (const [k, v] of Object.entries(c.rules)) {
      if (!(RULE_IDS as readonly string[]).includes(k)) throw new InputError(`rules.${k}`, `is not a rule (rules: ${RULE_IDS.join(", ")})`)
      out.rules[k as RuleId] = severity(v, `rules.${k}`, "off")
    }
  }
  if (c.failOn !== undefined) out.failOn = severity(c.failOn, "failOn", "never")
  return out
}

/** Parses config JSON text and resolves it. */
export function parseConfig(json: string): ResolvedConfig {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch (err) {
    throw new InputError("", `config is not valid JSON (${(err as Error).message})`)
  }
  return resolveConfig(value)
}
