// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Where the hover tooltip goes, so it stays inside the chart instead of spilling past an edge.

import type { Point } from "./path.ts"

export interface TooltipBox {
  x: number
  y: number
  width: number
  height: number
}

/**
 * A box for a two-line tooltip next to `anchor`: to the right of the point, or to its left near the right edge;
 * above the point, kept within `top`…`bottom`. The width is estimated from the longest line at about 7 px per
 * character (SVG text can't be measured before it is drawn), with a 120 px minimum.
 */
export function placeTooltip(anchor: Point, lines: readonly string[], bounds: { right: number; top: number; bottom: number }): TooltipBox {
  const longest = Math.max(0, ...lines.map((l) => l.length))
  const width = Math.max(120, Math.round(longest * 7 + 24))
  const height = 50
  const gap = 12
  const x = anchor[0] + gap + width > bounds.right ? anchor[0] - gap - width : anchor[0] + gap
  const y = Math.max(bounds.top, Math.min(anchor[1] - height, bounds.bottom - height - 8))
  return { x, y, width, height }
}
