// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Short number labels for axes and tooltips.

/**
 * A compact label: `12k` from 10,000 up, `1.5k` from 1,000, whole numbers from 100, one decimal from 10, otherwise
 * three significant digits (`0.0123`). Trailing zeros are dropped.
 */
export function formatNumber(v: number): string {
  if (!Number.isFinite(v)) return String(v)
  const a = Math.abs(v)
  if (a >= 10000) return `${Math.round(v / 1000)}k`
  if (a >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, "")}k`
  if (a >= 100) return Math.round(v).toString()
  if (a >= 10) return v.toFixed(1).replace(/\.0$/, "")
  return Number(v.toPrecision(3)).toString()
}
