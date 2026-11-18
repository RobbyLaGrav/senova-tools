// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Computed wording: comparative words come from the numbers, so a re-run that flips a result rewrites the sentence.
// Every helper compares the numbers *as printed*: if two values round to the same text, they are reported as the
// same, never as "cut to 0.21 from 0.21".

/** Which direction is an improvement for a metric. */
export type Better = "lower" | "higher"

export interface FormatOptions {
  /** Digits after the decimal point. Default 2. */
  digits?: number
  /** Unit appended after a space, for example "mm". The percent sign is handled by the percent helpers. */
  unit?: string
  /** Group thousands with commas: 12,345.6. Default false. */
  group?: boolean
}

const finite = (name: string, v: number): void => {
  if (!Number.isFinite(v)) throw new RangeError(`${name} must be a finite number, got ${v}`)
}

/** Formats a number deterministically (no locale): fixed digits, no "-0", optional thousands commas and unit. */
export function formatNumber(value: number, opts: FormatOptions = {}): string {
  finite("value", value)
  const digits = opts.digits ?? 2
  let text = value.toFixed(digits)
  if (/^-0(\.0+)?$/.test(text)) text = text.slice(1)
  if (opts.group) {
    const [int = "", frac] = text.split(".")
    const sign = int.startsWith("-") ? "-" : ""
    const grouped = int.replace("-", "").replace(/\B(?=(\d{3})+(?!\d))/g, ",")
    text = `${sign}${grouped}${frac === undefined ? "" : `.${frac}`}`
  }
  return opts.unit ? `${text} ${opts.unit}` : text
}

/** Percent change of `value` relative to `from`: (value − from) / |from| × 100. Throws when `from` is 0. */
export function percentChange(value: number, from: number): number {
  finite("value", value)
  finite("from", from)
  if (from === 0) throw new RangeError("percent change from 0 is undefined")
  return ((value - from) / Math.abs(from)) * 100
}

export interface ChangeOptions {
  /** Digits for the percentage. Default 0. */
  digits?: number
  /** Word for an increase. Default "more". */
  up?: string
  /** Word for a decrease. Default "less". */
  down?: string
  /** Text when the change rounds to zero. Default "no change". */
  same?: string
  /** Put a space before the % sign ("12 %"). Default false ("12%"). */
  spaceBeforePercent?: boolean
}

/** "12% more", "8% less" or "no change", from the percent change of `value` relative to `from`. */
export function describeChange(value: number, from: number, opts: ChangeOptions = {}): string {
  const pct = percentChange(value, from)
  const text = formatNumber(Math.abs(pct), { digits: opts.digits ?? 0 })
  if (Number(text) === 0) return opts.same ?? "no change"
  const sign = opts.spaceBeforePercent ? " %" : "%"
  return `${text}${sign} ${pct > 0 ? (opts.up ?? "more") : (opts.down ?? "less")}`
}

export interface TimesOptions {
  /** Digits for the ratio; trailing zeros are dropped (7.0 → 7). Default 1. */
  digits?: number
  /** "×" gives "7× less"; "times" gives "7 times less". Default "×". */
  style?: "×" | "times"
  /** Word when `value` is smaller. Default "less" ("fewer" suits counts). */
  less?: string
  /** Word when `value` is larger. Default "more". */
  more?: string
  /** Text when the ratio rounds to 1. Default "about the same". */
  same?: string
}

/**
 * How many times smaller or larger `value` is than `reference`: `times(600, 4608)` gives "7.7× less".
 * Both must be positive: a ratio with zero or a sign change has no honest "times" reading.
 */
export function times(value: number, reference: number, opts: TimesOptions = {}): string {
  finite("value", value)
  finite("reference", reference)
  if (value <= 0 || reference <= 0) throw new RangeError(`times() needs two positive numbers, got ${value} and ${reference}`)
  const ratio = Math.max(value, reference) / Math.min(value, reference)
  const text = formatNumber(ratio, { digits: opts.digits ?? 1 }).replace(/\.?0+$/, "")
  if (text === "1") return opts.same ?? "about the same"
  const n = opts.style === "times" ? `${text} times` : `${text}×`
  return `${n} ${value < reference ? (opts.less ?? "less") : (opts.more ?? "more")}`
}

export interface CompareOptions extends FormatOptions {
  /** Which direction is an improvement. Required: there is no safe default. */
  better: Better
  /** What is measured, for the sentence. Default "error" when lower is better, "score" when higher is. */
  metric?: string
  /** What `b` is, for the sentence. Default "the baseline". */
  against?: string
  /** Absolute difference treated as no difference, on top of "prints the same". Default 0. */
  tolerance?: number
}

export type Outcome = "better" | "worse" | "same"

export interface Comparison {
  /** "better" only when `a` beats `b` by more than the tolerance and the printed numbers differ. */
  outcome: Outcome
  /** Shorthand for `outcome === "better"`. */
  beats: boolean
  /** `a` and `b` as printed, with unit. */
  a: string
  b: string
  /** Percent change of `a` relative to `b`, or null when `b` is 0. */
  change: number | null
  /** A predicate to follow a subject: "cut the error to 0.21 mm from 0.34 mm", "did not beat the baseline (…)". */
  text: string
}

/**
 * Compares a result `a` with a baseline `b` and writes the predicate of the sentence:
 *
 * - better, lower is better: "cut the error to 0.21 mm from 0.34 mm"
 * - better, higher is better: "raised the score to 91.2 from 88.0"
 * - worse: "did not beat the baseline (0.41 mm against 0.34 mm)"
 * - same as printed: "matched the baseline (both 0.34 mm)"
 */
export function compare(a: number, b: number, opts: CompareOptions): Comparison {
  finite("a", a)
  finite("b", b)
  if (opts.better !== "lower" && opts.better !== "higher") throw new TypeError('compare() needs better: "lower" or "higher"')
  const fmt: FormatOptions = {}
  if (opts.digits !== undefined) fmt.digits = opts.digits
  if (opts.unit !== undefined) fmt.unit = opts.unit
  if (opts.group !== undefined) fmt.group = opts.group
  const A = formatNumber(a, fmt)
  const B = formatNumber(b, fmt)
  const tolerance = opts.tolerance ?? 0
  const lower = opts.better === "lower"
  const metric = opts.metric ?? (lower ? "error" : "score")
  const against = opts.against ?? "the baseline"
  let outcome: Outcome
  if (A === B || Math.abs(a - b) <= tolerance) outcome = "same"
  else outcome = (lower ? a < b : a > b) ? "better" : "worse"
  const text =
    outcome === "better"
      ? `${lower ? "cut" : "raised"} the ${metric} to ${A} from ${B}`
      : outcome === "worse"
        ? `did not beat ${against} (${A} against ${B})`
        : `matched ${against} (both ${A})`
  return { outcome, beats: outcome === "better", a: A, b: B, change: b === 0 ? null : percentChange(a, b), text }
}
