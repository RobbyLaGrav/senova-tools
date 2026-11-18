// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// smoothchart: the framework-free core. Path maths, ticks, scales, layout and nearest-point picking, as plain
// functions with no DOM and no dependencies. The React components are in "@senova/smoothchart/react".

export { areaPath, linearPath, linePath, monotoneSegments, round2, smoothPath, stepPath } from "./path.ts"
export type { CubicSegment, Curve, Point } from "./path.ts"
export { logTicks, niceTicks } from "./ticks.ts"
export { createScale, LOG_FLOOR, toAxisUnits } from "./scale.ts"
export type { Scale } from "./scale.ts"
export { formatNumber } from "./format.ts"
export { nearestPoint } from "./pick.ts"
export type { Pick } from "./pick.ts"
export { easeOutCubic, interpolateLines, sameShape } from "./tween.ts"
export { BAR_DEFAULTS, layoutBarChart, layoutLineChart, LINE_DEFAULTS } from "./layout.ts"
export type { Band, BandRect, Bar, BarLayout, BarLayoutOptions, BarRow, LineLayout, LineLayoutOptions, Margin, Series, Tick } from "./layout.ts"
export { placeTooltip } from "./tooltip.ts"
export type { TooltipBox } from "./tooltip.ts"
