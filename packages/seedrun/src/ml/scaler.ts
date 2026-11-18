// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors

/** Per-column standardisation fitted on a set of rows. */
export interface Scaler {
  readonly mean: Float64Array
  /** Population standard deviation per column; a constant column gets 1, so it maps to 0 instead of dividing by 0. */
  readonly std: Float64Array
  /** (row - mean) / std */
  apply(row: ArrayLike<number>): number[]
  /** row * std + mean */
  invert(row: ArrayLike<number>): number[]
}

/** Fits column means and standard deviations to rows of equal length. */
export function scaler(rows: readonly ArrayLike<number>[]): Scaler {
  const first = rows[0]
  if (first === undefined) throw new RangeError("scaler() needs at least one row")
  const n = rows.length
  const d = first.length
  const mean = new Float64Array(d)
  const std = new Float64Array(d)
  for (const r of rows) {
    if (r.length !== d) throw new RangeError(`every row needs ${d} values, got one with ${r.length}`)
    for (let j = 0; j < d; j++) mean[j] = (mean[j] as number) + (r[j] as number) / n
  }
  for (const r of rows) for (let j = 0; j < d; j++) std[j] = (std[j] as number) + ((r[j] as number) - (mean[j] as number)) ** 2 / n
  for (let j = 0; j < d; j++) std[j] = Math.sqrt(std[j] as number) || 1
  return {
    mean,
    std,
    apply: (r) => Array.from(r, (v, j) => (v - (mean[j] as number)) / (std[j] as number)),
    invert: (r) => Array.from(r, (v, j) => v * (std[j] as number) + (mean[j] as number)),
  }
}
