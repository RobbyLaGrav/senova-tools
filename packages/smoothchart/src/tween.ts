// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Animation maths for lines that glide to new data. The timing loop lives in the React entry; this is pure.

import type { Point } from "./path.ts"

/** Fast start, gentle landing. `t` in [0, 1]. */
export function easeOutCubic(t: number): number {
  const k = Math.min(1, Math.max(0, t))
  return 1 - (1 - k) ** 3
}

/** True when both sets have the same number of lines with the same number of points each, so they can tween. */
export function sameShape(a: readonly (readonly Point[])[], b: readonly (readonly Point[])[]): boolean {
  return a.length === b.length && a.every((line, i) => line.length === (b[i]?.length ?? -1))
}

/**
 * Every point moved fraction `t` (0 to 1, already eased) of the way from `from` to `to`. If the shapes differ there
 * is nothing to pair up, so the result is `to`.
 */
export function interpolateLines(from: readonly (readonly Point[])[], to: readonly (readonly Point[])[], t: number): Point[][] {
  if (!sameShape(from, to)) return to.map((line) => [...line])
  return to.map((line, i) =>
    line.map((p, j) => {
      const q = (from[i] as readonly Point[])[j] as Point
      return [q[0] + (p[0] - q[0]) * t, q[1] + (p[1] - q[1]) * t] as const
    }),
  )
}
