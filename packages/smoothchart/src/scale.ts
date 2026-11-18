// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Scales: map data values to screen pixels, linear or log10.

/** Values at or below zero are clamped to this on a log axis (a log axis can't show zero or negatives). */
export const LOG_FLOOR = 1e-9

/** A data-to-pixel mapping. */
export interface Scale {
  /** Pixel position of a data value. Values outside the domain are clamped to its ends when `clamp` is set. */
  (value: number): number
  /** The domain in transformed units (log10 of the values on a log scale). */
  readonly domain: readonly [number, number]
  readonly range: readonly [number, number]
  readonly log: boolean
  /** Data value to transformed units: `log10(v)` on a log scale, `v` otherwise. */
  readonly transform: (value: number) => number
}

/** The transform a scale applies before mapping: log10 (with zero and negatives clamped) or none. */
export function toAxisUnits(value: number, log: boolean): number {
  return log ? Math.log10(Math.max(value, LOG_FLOOR)) : value
}

/**
 * A scale from `domain` (in transformed units) to the pixel `range`. A zero-width domain maps every value to the
 * start of the range. Put the larger pixel first in `range` for an upward y axis.
 */
export function createScale(domain: readonly [number, number], range: readonly [number, number], options: { log?: boolean; clamp?: boolean } = {}): Scale {
  const log = options.log ?? false
  const clamp = options.clamp ?? false
  const [d0, d1] = domain
  const [r0, r1] = range
  const width = d1 - d0 || 1
  const lo = Math.min(d0, d1), hi = Math.max(d0, d1)
  const transform = (v: number): number => toAxisUnits(v, log)
  const scale = (v: number): number => {
    let t = transform(v)
    if (clamp) t = Math.min(Math.max(t, lo), hi)
    return r0 + ((t - d0) / width) * (r1 - r0)
  }
  return Object.assign(scale, { domain: [d0, d1] as const, range: [r0, r1] as const, log, transform })
}
