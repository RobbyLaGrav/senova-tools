// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Chart geometry without a framework: from data and options to scales, ticks, screen points and bar rows.
// The React entry draws exactly what these functions return, so anything a chart shows can be tested here.

import type { Curve, Point } from "./path.ts"
import { createScale, toAxisUnits, type Scale } from "./scale.ts"
import { logTicks, niceTicks } from "./ticks.ts"

/** One line on a line chart. */
export interface Series {
  /** Shown in the legend and the tooltip. Must be unique within a chart. */
  name: string
  /** `[x, y]` data points, in any order (they are sorted by x). Points with a non-finite coordinate are dropped. */
  points: readonly Point[]
  /** Draw in the accent colour, a little thicker: the line the reader should look at. */
  highlight?: boolean
  dashed?: boolean
  /** Shade the area under the line. */
  area?: boolean
  /** `"smooth"` (default, monotone), `"linear"` or `"step"`. */
  curve?: Curve
  /** Any CSS colour; overrides the default and highlight colours for this line. */
  color?: string
}

/** A shaded x-range drawn behind the data, e.g. "the stage was moving". */
export interface Band {
  from: number
  to: number
  label?: string
}

export interface Margin {
  top: number
  right: number
  bottom: number
  left: number
}

export interface LineLayoutOptions {
  series: readonly Series[]
  /** viewBox width and height. The SVG scales to its container's width; these set the aspect ratio and text size. */
  width?: number
  height?: number
  margin?: Partial<Margin>
  logX?: boolean
  logY?: boolean
  /** Fix an end of an axis (data units). By default x fits the data and y runs from 0 (or the lowest value) to 8% above the highest. */
  xMin?: number
  xMax?: number
  yMin?: number
  yMax?: number
  /** Tick values to use instead of the automatic ones. */
  xTicks?: readonly number[]
  yTicks?: readonly number[]
  bands?: readonly Band[]
}

export interface Tick {
  value: number
  /** Pixel position along its axis. */
  pos: number
}

export interface BandRect {
  band: Band
  x: number
  width: number
}

export interface LineLayout {
  width: number
  height: number
  /** The plotting area, in pixels. */
  plot: { left: number; top: number; right: number; bottom: number }
  x: Scale
  y: Scale
  xTicks: Tick[]
  yTicks: Tick[]
  bands: BandRect[]
  /** Each series' points sorted by x, in data units (index-aligned with `lines`). */
  data: Point[][]
  /** The same points in screen pixels. */
  lines: Point[][]
}

export const LINE_DEFAULTS = { width: 680, height: 320, margin: { top: 14, right: 18, bottom: 46, left: 60 } as Margin }

const finite = (p: Point): boolean => Number.isFinite(p[0]) && Number.isFinite(p[1])
const minMax = (vs: readonly number[]): [number, number] | null => (vs.length ? [Math.min(...vs), Math.max(...vs)] : null)

/** Lays out a line chart: domains, scales, ticks, bands and every series' screen points. */
export function layoutLineChart(options: LineLayoutOptions): LineLayout {
  const width = options.width ?? LINE_DEFAULTS.width
  const height = options.height ?? LINE_DEFAULTS.height
  const m: Margin = { ...LINE_DEFAULTS.margin, ...options.margin }
  const logX = options.logX ?? false, logY = options.logY ?? false
  const plot = { left: m.left, top: m.top, right: width - m.right, bottom: height - m.bottom }

  const data = options.series.map((s) => s.points.filter(finite).toSorted((a, b) => a[0] - b[0]))
  const all = data.flat()
  const tx = (v: number): number => toAxisUnits(v, logX)
  const ty = (v: number): number => toAxisUnits(v, logY)

  // x: fit the data unless an end is fixed
  const xr = minMax(all.map((p) => tx(p[0]))) ?? [0, 1]
  const x0 = options.xMin !== undefined ? tx(options.xMin) : xr[0]
  const x1 = options.xMax !== undefined ? tx(options.xMax) : xr[1]

  // y: whole decades on a log axis; from zero (or below) to a little headroom on a linear one
  const yr = minMax(all.map((p) => ty(p[1]))) ?? [0, 1]
  let y0 = options.yMin !== undefined ? ty(options.yMin) : logY ? Math.floor(yr[0]) : Math.min(0, yr[0])
  let y1 = options.yMax !== undefined ? ty(options.yMax) : logY ? Math.ceil(yr[1]) : yr[1] + (yr[1] - y0) * 0.08
  if (y1 === y0) y1 = y0 + 1
  if (y1 < y0) [y0, y1] = [y1, y0]

  const x = createScale([x0, x1], [plot.left, plot.right], { log: logX })
  const y = createScale([y0, y1], [plot.bottom, plot.top], { log: logY, clamp: true })

  const inX = (v: number): boolean => {
    const t = tx(v)
    return t >= Math.min(x0, x1) - 1e-9 && t <= Math.max(x0, x1) + 1e-9
  }
  const inY = (v: number): boolean => ty(v) >= y0 - 1e-9 && ty(v) <= y1 + 1e-9

  let xValues: readonly number[]
  if (options.xTicks) xValues = options.xTicks
  else if (logX) {
    // ticks at the data's own x values (sizes like 1, 2, 4, 8…) when there are few, otherwise powers of ten
    const distinct = [...new Set(all.map((p) => p[0]))].sort((a, b) => a - b)
    const every = Math.ceil(distinct.length / 8)
    xValues = distinct.length > 0 && distinct.length <= 16 ? distinct.filter((_, i) => i % every === 0) : logTicks(x0, x1)
  } else xValues = niceTicks(x0, x1, 6)
  const yValues = options.yTicks ?? (logY ? logTicks(y0, y1) : niceTicks(y0, y1, 5))

  const bands: BandRect[] = (options.bands ?? []).map((band) => {
    const a = Math.min(Math.max(x(band.from), plot.left), plot.right)
    const b = Math.min(Math.max(x(band.to), plot.left), plot.right)
    return { band, x: Math.min(a, b), width: Math.max(1, Math.abs(b - a)) }
  })

  return {
    width,
    height,
    plot,
    x,
    y,
    xTicks: xValues.filter(inX).map((value) => ({ value, pos: x(value) })),
    yTicks: yValues.filter(inY).map((value) => ({ value, pos: y(value) })),
    bands,
    data,
    lines: data.map((pts) => pts.map((p) => [x(p[0]), y(p[1])] as const)),
  }
}

/** One bar on a bar chart. Values below zero are drawn as zero. */
export interface Bar {
  label: string
  value: number
  highlight?: boolean
  /** Extra text shown under the chart while this bar is hovered. */
  detail?: string
  /** Any CSS colour; overrides the default and highlight colours for this bar. */
  color?: string
}

export interface BarLayoutOptions {
  bars: readonly Bar[]
  /** Bar length grows with log10(1 + value) instead of value: for values that span several orders of magnitude. */
  log?: boolean
  /** Pixel widths of the label column, the bar track and the value column. */
  labelWidth?: number
  trackWidth?: number
  valueWidth?: number
  rowHeight?: number
  /** Longer labels are cut with an ellipsis (the full label stays in the accessible description). */
  maxLabelChars?: number
  /** Leave room for a one-line note under the bars. */
  note?: boolean
}

export interface BarRow {
  bar: Bar
  /** Top of the row, in pixels. */
  y: number
  /** Bar length as a fraction of the track (0.004 to 1, so even a tiny value shows a sliver). */
  fraction: number
  label: string
}

export interface BarLayout {
  width: number
  height: number
  labelWidth: number
  trackWidth: number
  rowHeight: number
  rows: BarRow[]
}

export const BAR_DEFAULTS = { labelWidth: 290, trackWidth: 330, valueWidth: 110, rowHeight: 32, maxLabelChars: 44 }

/** Lays out a horizontal bar chart: one row per bar, bar lengths as fractions of the track. */
export function layoutBarChart(options: BarLayoutOptions): BarLayout {
  const labelWidth = options.labelWidth ?? BAR_DEFAULTS.labelWidth
  const trackWidth = options.trackWidth ?? BAR_DEFAULTS.trackWidth
  const valueWidth = options.valueWidth ?? BAR_DEFAULTS.valueWidth
  const rowHeight = options.rowHeight ?? BAR_DEFAULTS.rowHeight
  const maxChars = Math.max(2, options.maxLabelChars ?? BAR_DEFAULTS.maxLabelChars)
  const value = (b: Bar): number => (Number.isFinite(b.value) ? Math.max(0, b.value) : 0)
  const max = Math.max(0, ...options.bars.map(value)) || 1
  const fraction = (v: number): number => Math.max(0.004, Math.min(1, options.log ? Math.log10(1 + v) / Math.log10(1 + max) : v / max))
  return {
    width: labelWidth + trackWidth + valueWidth,
    height: options.bars.length * rowHeight + (options.note ? 30 : 8),
    labelWidth,
    trackWidth,
    rowHeight,
    rows: options.bars.map((bar, i) => ({
      bar,
      y: i * rowHeight + 6,
      fraction: fraction(value(bar)),
      label: bar.label.length > maxChars ? `${bar.label.slice(0, maxChars - 1)}…` : bar.label,
    })),
  }
}
