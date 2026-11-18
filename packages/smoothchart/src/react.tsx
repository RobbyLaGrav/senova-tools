// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
"use client"

// smoothchart/react: <LineChart> and <BarChart>. All geometry comes from the core (layout.ts, path.ts, pick.ts);
// this file only holds state (hover, hidden series, tweening) and draws SVG. Styles: "@senova/smoothchart/styles.css".
//
// - Hover is per line: the point nearest the pointer on any visible line is picked, that line comes forward, the
//   others fade, and the tooltip shows that one value. No crosshair across all lines.
// - Pointer work is batched to one pick per animation frame.
// - When the data changes, lines glide to their new values and bars grow or shrink (a CSS transform), unless the
//   reader prefers reduced motion.

import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react"

import { formatNumber } from "./format.ts"
import { layoutBarChart, layoutLineChart, type Bar, type BarLayoutOptions, type LineLayoutOptions, type Series } from "./layout.ts"
import { areaPath, linePath, round2, type Point } from "./path.ts"
import { nearestPoint, type Pick } from "./pick.ts"
import { placeTooltip } from "./tooltip.ts"
import { easeOutCubic, interpolateLines, sameShape } from "./tween.ts"

export type { Band, Bar, Series } from "./layout.ts"

const reducedMotion = (): boolean => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true

const colorVar = (color: string | undefined): CSSProperties | undefined => (color ? ({ "--sc-series-color": color } as CSSProperties) : undefined)

const cx = (...names: (string | false | null | undefined)[]): string => names.filter(Boolean).join(" ")

/**
 * Screen points that glide to `target` over `ms` milliseconds (ease-out cubic) whenever it changes. Snaps instead
 * when the number of lines or points changes, or when the reader prefers reduced motion.
 */
export function useTweenedLines(target: Point[][], ms = 450): Point[][] {
  const [shown, setShown] = useState(target)
  const from = useRef(target)
  const key = JSON.stringify(target)
  useEffect(() => {
    const start = from.current
    if (ms <= 0 || !sameShape(start, target) || reducedMotion()) {
      from.current = target
      setShown(target)
      return
    }
    const t0 = performance.now()
    let raf = 0
    const tick = (now: number): void => {
      const k = Math.min(1, (now - t0) / ms)
      const cur = interpolateLines(start, target, easeOutCubic(k))
      from.current = cur
      setShown(cur)
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // `key` stands for `target`: a new array with the same numbers must not restart the animation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ms])
  return shown
}

export interface LineChartProps extends Omit<LineLayoutOptions, "series"> {
  /** Shown under the chart and used as the start of the accessible description. */
  title: string
  series: readonly Series[]
  xLabel?: string
  yLabel?: string
  /** Appended to values in the tooltip and the accessible description, e.g. " ms". */
  xUnit?: string
  yUnit?: string
  /** Tick and tooltip labels. Default: `formatNumber`. */
  formatX?: (value: number) => string
  formatY?: (value: number) => string
  /** How close (in chart pixels) the pointer must be to a point to show it. Default 28. */
  hoverRadius?: number
  /** Length of the data-change animation in ms; 0 turns it off. Default 450. */
  duration?: number
  /** Dots are drawn on lines with at most this many points. Default 12. */
  maxDots?: number
  className?: string
}

/** A line chart with monotone smooth lines, per-line hover, a legend that toggles lines, bands and log axes. */
export function LineChart(props: LineChartProps) {
  const { title, series, xLabel, yLabel, xUnit = "", yUnit = "", formatX = formatNumber, formatY = formatNumber } = props
  const hoverRadius = props.hoverRadius ?? 28
  const maxDots = props.maxDots ?? 12
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set())
  const [hover, setHover] = useState<Pick | null>(null)
  const [focusSeries, setFocusSeries] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const pending = useRef<number | null>(null)

  const layout = useMemo(
    () => layoutLineChart({ ...props, series }),
    // the layout depends on the data and the layout options only, not on labels or callbacks
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series, props.width, props.height, JSON.stringify(props.margin), props.logX, props.logY, props.xMin, props.xMax, props.yMin, props.yMax, props.xTicks, props.yTicks, props.bands],
  )
  const { width: W, height: H, plot } = layout
  const screen = useTweenedLines(layout.lines, props.duration ?? 450)
  const latest = useRef({ screen, hidden })
  latest.current = { screen, hidden }

  const paths = useMemo(
    () =>
      screen.map((pts, i) => {
        const s = series[i]
        const line = linePath(pts, s?.curve)
        return { line, area: s?.area ? areaPath(line, pts, plot.bottom) : "" }
      }),
    [screen, series, plot.bottom],
  )

  useEffect(() => () => {
    if (pending.current !== null) cancelAnimationFrame(pending.current)
  }, [])

  const onMove = (e: ReactPointerEvent<SVGSVGElement>): void => {
    const { clientX, clientY } = e
    if (pending.current !== null) cancelAnimationFrame(pending.current)
    pending.current = requestAnimationFrame(() => {
      pending.current = null
      const svg = svgRef.current
      if (!svg) return
      const r = svg.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return
      const x = ((clientX - r.left) / r.width) * W, y = ((clientY - r.top) / r.height) * H
      const { screen: lines, hidden: off } = latest.current
      setHover(nearestPoint(lines, x, y, hoverRadius, (s) => off.has(series[s]?.name ?? "")))
    })
  }

  const toggle = (name: string): void =>
    setHidden((h) => {
      const next = new Set(h)
      if (next.has(name)) next.delete(name)
      else if (series.length - next.size > 1) next.add(name) // always keep one line visible
      return next
    })

  const active = hover?.series ?? focusSeries
  const hp = hover ? screen[hover.series]?.[hover.index] : undefined
  const hv = hover ? layout.data[hover.series]?.[hover.index] : undefined
  const hs = hover ? series[hover.series] : undefined
  const tipLines = hs && hv ? [hs.name, `${formatY(hv[1])}${yUnit} at ${formatX(hv[0])}${xUnit}`] : []
  const tip = hp ? placeTooltip(hp, tipLines, { right: W - 4, top: plot.top, bottom: plot.bottom }) : null
  const bandLabels = [...new Set((props.bands ?? []).map((b) => b.label).filter((l): l is string => !!l))]
  const description = `${title}. ${series.map((s) => `${s.name}: ${s.points.map((p) => `${formatX(p[0])}${xUnit} gives ${formatY(p[1])}${yUnit}`).join(", ")}`).join(". ")}`

  return (
    <figure className={cx("sc-figure", props.className)}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="sc-svg sc-interactive"
        role="img"
        aria-label={description}
        onPointerMove={onMove}
        onPointerLeave={() => {
          if (pending.current !== null) cancelAnimationFrame(pending.current)
          pending.current = null
          setHover(null)
        }}
      >
        {layout.bands.map((b, i) => (
          <rect key={`band${i}`} x={round2(b.x)} y={plot.top} width={round2(b.width)} height={plot.bottom - plot.top} className="sc-band" />
        ))}
        {layout.yTicks.map((t) => (
          <g key={`y${t.value}`}>
            <line x1={plot.left} x2={plot.right} y1={round2(t.pos)} y2={round2(t.pos)} className="sc-grid" />
            <text x={plot.left - 8} y={round2(t.pos + 4)} textAnchor="end" className="sc-axis">
              {formatY(t.value)}
            </text>
          </g>
        ))}
        {layout.xTicks.map((t) => (
          <text key={`x${t.value}`} x={round2(t.pos)} y={plot.bottom + 18} textAnchor="middle" className="sc-axis">
            {formatX(t.value)}
          </text>
        ))}
        {xLabel && (
          <text x={(plot.left + plot.right) / 2} y={H - 6} textAnchor="middle" className="sc-axis-title">
            {xLabel}
          </text>
        )}
        {yLabel && (
          <text x={14} y={(plot.top + plot.bottom) / 2} textAnchor="middle" transform={`rotate(-90 14 ${(plot.top + plot.bottom) / 2})`} className="sc-axis-title">
            {yLabel}
          </text>
        )}
        {series.map((s, i) =>
          hidden.has(s.name) ? null : (
            <g key={s.name} style={colorVar(s.color)} className={cx("sc-series", s.highlight && "sc-hi", active !== null && active !== i && "sc-dim", active === i && "sc-on")}>
              {paths[i]?.area ? <path d={paths[i].area} className="sc-area" /> : null}
              {s.dashed ? (
                <path d={paths[i]?.line} className="sc-line sc-fade-in" strokeDasharray="6 5" />
              ) : (
                <path d={paths[i]?.line} className="sc-line sc-draw" pathLength={1} />
              )}
              {/* a wide invisible stroke makes the whole line easy to point at */}
              <path d={paths[i]?.line} className="sc-hit" onPointerEnter={() => setFocusSeries(i)} onPointerLeave={() => setFocusSeries(null)} />
              {s.points.length <= maxDots && screen[i]?.map((p, j) => <circle key={j} cx={round2(p[0])} cy={round2(p[1])} r={3} className="sc-dot" />)}
            </g>
          ),
        )}
        {hover && hp && tip && hs && (
          <g pointerEvents="none" className={cx("sc-hover", hs.highlight && "sc-hi")} style={colorVar(hs.color)}>
            <circle cx={round2(hp[0])} cy={round2(hp[1])} r={6} className="sc-ring" />
            <g transform={`translate(${round2(tip.x)}, ${round2(tip.y)})`}>
              <rect width={tip.width} height={tip.height} rx={8} className="sc-tip" />
              <text x={12} y={20} className="sc-tip-title">
                {tipLines[0]}
              </text>
              <text x={12} y={38} className="sc-tip-text">
                {tipLines[1]}
              </text>
            </g>
          </g>
        )}
      </svg>
      <figcaption>
        {title}
        <span className="sc-legend">
          {series.map((s, i) => (
            <button
              type="button"
              key={s.name}
              aria-pressed={!hidden.has(s.name)}
              style={colorVar(s.color)}
              className={cx("sc-key", s.highlight && "sc-hi", s.dashed && "sc-key-dash")}
              onPointerEnter={() => setFocusSeries(i)}
              onPointerLeave={() => setFocusSeries(null)}
              onFocus={() => setFocusSeries(i)}
              onBlur={() => setFocusSeries(null)}
              onClick={() => toggle(s.name)}
            >
              {s.name}
            </button>
          ))}
          {bandLabels.map((l) => (
            <span key={l} className="sc-key sc-key-band">
              {l}
            </span>
          ))}
        </span>
      </figcaption>
    </figure>
  )
}

export interface BarChartProps extends Omit<BarLayoutOptions, "bars" | "note"> {
  title: string
  bars: readonly Bar[]
  /** Appended to each value, e.g. "ms". */
  unit?: string
  /** Decimal places for values (ignored when `format` is given). Default 2. */
  digits?: number
  format?: (value: number) => string
  /** Adds "Shorter is better." (true) or "Longer is better." (false) under the bars. */
  lowerIsBetter?: boolean
  /** Any other note under the bars. */
  note?: string
  className?: string
}

/** A horizontal bar chart. Bars grow from zero on first paint and to new lengths when values change. */
export function BarChart(props: BarChartProps) {
  const { title, bars, unit = "", digits = 2 } = props
  const format = props.format ?? ((v: number) => v.toFixed(digits))
  const [active, setActive] = useState<number | null>(null)
  const noteText = [props.log ? "Log scale." : "", props.lowerIsBetter === true ? "Shorter is better." : props.lowerIsBetter === false ? "Longer is better." : "", props.note ?? ""].filter(Boolean).join(" ")
  const layout = layoutBarChart({ ...props, bars, note: noteText !== "" })
  const { width: W, height: H, labelWidth, trackWidth, rowHeight } = layout
  const valueText = (b: Bar): string => `${format(b.value)}${unit ? ` ${unit}` : ""}`
  const detail = active !== null ? bars[active]?.detail : undefined
  return (
    <figure className={cx("sc-figure", props.className)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}. ${bars.map((b) => `${b.label}: ${valueText(b)}`).join("; ")}`} className="sc-svg" onPointerLeave={() => setActive(null)}>
        {layout.rows.map((row, i) => (
          <g key={row.bar.label} style={colorVar(row.bar.color)} onPointerEnter={() => setActive(i)} className={cx("sc-barrow", row.bar.highlight && "sc-hi", active !== null && active !== i && "sc-dim")}>
            <rect x={0} y={row.y} width={W} height={rowHeight} fill="transparent" />
            <text x={labelWidth - 12} y={row.y + 16} textAnchor="end" className="sc-label">
              {row.label}
            </text>
            <rect x={labelWidth} y={row.y + 4} width={trackWidth} height={rowHeight - 14} rx={4} className="sc-track" />
            {/* scaled with a CSS transform, so a change of value animates smoothly */}
            <rect x={labelWidth} y={row.y + 4} width={trackWidth} height={rowHeight - 14} rx={4} className="sc-bar" style={{ transform: `scaleX(${Number(row.fraction.toFixed(4))})`, transformOrigin: `${labelWidth}px 0` }} />
            <text x={labelWidth} y={row.y + 16} className="sc-value" style={{ transform: `translateX(${round2(row.fraction * trackWidth + 8)}px)` }}>
              {valueText(row.bar)}
            </text>
          </g>
        ))}
        {noteText && (
          <text x={labelWidth} y={H - 4} className="sc-axis">
            {noteText}
          </text>
        )}
      </svg>
      <figcaption>
        {title}
        {detail ? <span className="sc-detail">{detail}</span> : null}
      </figcaption>
    </figure>
  )
}
