// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors

/** A rate for display: "830", "12.4 k", "1.2 M". */
export function formatRate(value: number): string {
  if (!Number.isFinite(value)) return value > 0 ? "∞" : "–"
  const a = Math.abs(value)
  if (a >= 1e9) return `${(value / 1e9).toFixed(1)} G`
  if (a >= 1e6) return `${(value / 1e6).toFixed(1)} M`
  if (a >= 1e3) return `${(value / 1e3).toFixed(1)} k`
  return `${Math.round(value)}`
}

/** A saving ratio for display: "∞×" with no events, whole numbers from 100 up, one decimal below. */
export function formatRatio(value: number): string {
  if (!Number.isFinite(value)) return "∞×"
  return value >= 100 ? `${Math.round(value)}×` : `${value.toFixed(1)}×`
}
