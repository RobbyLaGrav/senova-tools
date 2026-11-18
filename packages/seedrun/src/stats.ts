// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors

function assertNonEmpty(values: ArrayLike<number>, fn: string): void {
  if (values.length === 0) throw new RangeError(`${fn}() needs at least one value`)
}

/** Arithmetic mean. */
export function mean(values: ArrayLike<number>): number {
  assertNonEmpty(values, "mean")
  let s = 0
  for (let i = 0; i < values.length; i++) s += values[i] as number
  return s / values.length
}

/** Root mean square. */
export function rms(values: ArrayLike<number>): number {
  assertNonEmpty(values, "rms")
  let s = 0
  for (let i = 0; i < values.length; i++) s += (values[i] as number) ** 2
  return Math.sqrt(s / values.length)
}

/** The p-th percentile (0 to 100), nearest rank on the sorted values (no interpolation). */
export function percentile(values: ArrayLike<number>, p: number): number {
  assertNonEmpty(values, "percentile")
  if (!(p >= 0 && p <= 100)) throw new RangeError(`percentile p must be from 0 to 100, got ${p}`)
  const sorted = Array.from(values).sort((x, y) => x - y)
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))))
  return sorted[i] as number
}

/** Rounds to `digits` decimal places, for compact results files. */
export function round(value: number, digits = 3): number {
  const f = 10 ** digits
  return Math.round(value * f) / f
}
