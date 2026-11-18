// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Per-line hover: find the one point nearest the pointer, across every visible line.

import type { Point } from "./path.ts"

/** The point a pointer picked: which series, which point in it, and how far away (pixels). */
export interface Pick {
  series: number
  index: number
  distance: number
}

/**
 * The point nearest `(x, y)` on any line, if it is within `radius` (screen pixels). Lines for which `skip(series)`
 * returns true (hidden ones) are ignored. On a tie the earlier series and point win.
 *
 * This is what makes hover work per line: the reader points at a line, not at an x position, so only that line's
 * value is shown.
 */
export function nearestPoint(lines: readonly (readonly Point[])[], x: number, y: number, radius = 28, skip?: (series: number) => boolean): Pick | null {
  let best: Pick | null = null
  let bestSq = radius * radius
  lines.forEach((pts, s) => {
    if (skip?.(s)) return
    pts.forEach((p, i) => {
      const dx = p[0] - x, dy = p[1] - y
      const sq = dx * dx + dy * dy
      if (sq <= bestSq && (best === null || sq < bestSq)) {
        bestSq = sq
        best = { series: s, index: i, distance: Math.sqrt(sq) }
      }
    })
  })
  return best
}
