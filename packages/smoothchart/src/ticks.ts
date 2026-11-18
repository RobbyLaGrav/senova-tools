// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Axis ticks: round numbers on linear axes, powers of ten on log axes.

/**
 * About `count` round tick values covering `[lo, hi]`: steps of 1, 2, 2.5 or 5 times a power of ten, every tick
 * inside the range. The ends may be swapped. A zero-width range gives the one value; non-finite input gives none.
 */
export function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return []
  if (lo > hi) [lo, hi] = [hi, lo]
  const n = Math.max(1, Math.floor(count))
  const span = hi - lo
  if (span === 0) return [lo]
  const base = 10 ** Math.floor(Math.log10(span / n))
  const step = ([1, 2, 2.5, 5, 10].find((k) => span / (k * base) <= n) ?? 10) * base
  const first = Math.ceil(lo / step - 1e-9)
  const out: number[] = []
  // multiply rather than add, so the error doesn't build up from one tick to the next
  for (let i = first; i * step <= hi + step * 1e-9; i++) out.push(Number((i * step).toFixed(10)))
  return out
}

/**
 * Powers of ten between `10^loExp` and `10^hiExp` (whole exponents), thinned to at most `max` ticks by taking
 * every second, third… power.
 */
export function logTicks(loExp: number, hiExp: number, max = 8): number[] {
  if (!Number.isFinite(loExp) || !Number.isFinite(hiExp)) return []
  const a = Math.ceil(Math.min(loExp, hiExp) - 1e-9), b = Math.floor(Math.max(loExp, hiExp) + 1e-9)
  const every = Math.max(1, Math.ceil((b - a + 1) / Math.max(1, max)))
  const out: number[] = []
  for (let e = a; e <= b; e += every) out.push(Number((10 ** e).toPrecision(12)))
  return out
}
