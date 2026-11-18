// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Rule-based headlines: the setting a headline reports is picked by a written rule ("the largest saving within 10 %
// extra error"), never by hand, so nobody can quietly choose the best-looking row after seeing the data.
import type { Better } from "./wording.ts"

export interface HeadlineRule<T> {
  /** The rule in words, shown next to the headline: "largest saving within 10 % extra error". */
  label: string
  /** What the rule ranks by. Must return a finite number for every item that passes `where`. */
  score: (item: T) => number
  /** Pick the highest score ("max", default) or the lowest ("min"). */
  goal?: "max" | "min"
  /** Only items that pass this filter can be picked. */
  where?: (item: T) => boolean
}

export interface Headline<T> {
  item: T
  index: number
  score: number
  /** The rule's label, to print beside the headline. */
  rule: string
}

/**
 * Picks the item a rule selects. Returns null when no item passes `where`, so the page has to say so instead of
 * falling back to a hand-picked row. Ties go to the earliest item, so the result doesn't depend on sort stability.
 */
export function pickHeadline<T>(items: readonly T[], rule: HeadlineRule<T>): Headline<T> | null {
  const sign = (rule.goal ?? "max") === "max" ? 1 : -1
  let best: Headline<T> | null = null
  items.forEach((item, index) => {
    if (rule.where && !rule.where(item)) return
    const score = rule.score(item)
    if (!Number.isFinite(score)) throw new RangeError(`rule "${rule.label}": score for item ${index} is ${score}`)
    if (best === null || sign * score > sign * best.score) best = { item, index, score, rule: rule.label }
  })
  return best
}

export interface WithinOptions {
  /** Allowed worsening, in percent of the reference's size. */
  pct: number
  /** Which direction is an improvement. */
  better: Better
}

/**
 * True when `value` is no more than `pct` % worse than `reference`. With lower-is-better, `within(0.33, 0.30,
 * { pct: 10, better: "lower" })` is true (10 % worse) and 0.34 is false. Anything better than the reference passes.
 */
export function within(value: number, reference: number, opts: WithinOptions): boolean {
  if (!Number.isFinite(value) || !Number.isFinite(reference)) throw new RangeError("within() needs finite numbers")
  if (!(opts.pct >= 0)) throw new RangeError(`within() needs pct >= 0, got ${opts.pct}`)
  const slack = (Math.abs(reference) * opts.pct) / 100
  // A tiny epsilon so 0.30 * 1.10 = 0.33000000000000007 still admits 0.33.
  const eps = 1e-12 * Math.max(1, Math.abs(reference))
  return opts.better === "lower" ? value <= reference + slack + eps : value >= reference - slack - eps
}
