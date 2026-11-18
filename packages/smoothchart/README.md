# Smoothchart

Tiny SVG line and bar charts with no dependencies: smooth lines that never invent a value, hover that shows one line at a time, and animated data changes.

**For:** web developers and research sites that want clean, honest charts without a charting library. **Status:** in progress.

- **Monotone smooth lines.** Curves use Fritsch-Carlson monotone cubic interpolation: they pass through every point and never overshoot, so a smooth line never shows a peak or dip that isn't in the data.
- **Hover per line.** The point nearest the pointer (within 28 px) on any visible line is picked. That line comes forward, the others fade, and the tooltip shows only that line's value. No crosshair through every line.
- **Legend toggles lines.** It always keeps at least one line visible.
- **Motion.** Lines draw in on first paint and glide to new values when the data changes; bars grow from zero and resize with a CSS transform. With `prefers-reduced-motion: reduce`, nothing moves.
- **Log axes and shaded bands** (for example "the stage was moving").
- **Identical server and browser output.** Every path coordinate is rounded to 0.01 px, so server-rendered markup matches the browser's and React doesn't report a hydration mismatch.
- **Framework-free core.** All the maths (paths, ticks, scales, layout, nearest-point picking) is plain TypeScript in `@senova/smoothchart`. The React components in `@senova/smoothchart/react` only hold state and draw.

## Install

```sh
npm install @senova/smoothchart
```

The React entry needs React 18 or newer, which you already have. The core needs nothing.

## Two-minute example

```tsx
import { BarChart, LineChart } from "@senova/smoothchart/react"
import "@senova/smoothchart/styles.css"

export function Results() {
  return (
    <>
      <LineChart
        title="Latency as the job count doubles"
        xLabel="Parallel jobs"
        yLabel="Latency (ms)"
        yUnit=" ms"
        logX
        series={[
          { name: "Baseline", points: [[1, 12], [2, 23], [4, 41], [8, 85], [16, 160]] },
          { name: "New scheduler", points: [[1, 6], [2, 8], [4, 10], [8, 13], [16, 17]], highlight: true, area: true },
        ]}
        bands={[{ from: 1, to: 2, label: "Cache warming" }]}
      />
      <BarChart
        title="Latency at 16 jobs"
        unit="ms"
        digits={0}
        lowerIsBetter
        bars={[
          { label: "New scheduler", value: 17, highlight: true },
          { label: "Baseline", value: 160 },
        ]}
      />
    </>
  )
}
```

Change `series` or `bars` and the chart animates to the new values.

Without React, the core gives you the same geometry to draw however you like ([examples/core.ts](examples/core.ts)):

```ts
import { layoutLineChart, nearestPoint, smoothPath } from "@senova/smoothchart"

const layout = layoutLineChart({ series: [{ name: "a", points: [[0, 1], [1, 3], [2, 2]] }] })
const d = smoothPath(layout.lines[0] ?? []) // "M60,193.75C160.33,140.26 …" (pixels, rounded to 0.01)
const hit = nearestPoint(layout.lines, 355, 40) // { series: 0, index: 1, distance: 9.02 } or null when nothing is near
```

### Example page

```sh
npm install
npm run example -w @senova/smoothchart
```

Then open http://127.0.0.1:4178/examples/. It builds the package, serves this folder on 127.0.0.1 only, and loads React 19.1.0 from esm.sh (the example's only network use; the package itself fetches nothing). It shows a log-axis line chart with a band, a dashed line, an area and a highlighted line, buttons to change the data and the y axis, and a bar chart with hover details.

## API: React (`@senova/smoothchart/react`)

### `<LineChart>`

| Prop | Type | Default | |
| --- | --- | --- | --- |
| `title` | `string` | required | Caption under the chart; starts the accessible description. |
| `series` | `Series[]` | required | The lines (see below). |
| `xLabel`, `yLabel` | `string` | none | Axis titles. |
| `xUnit`, `yUnit` | `string` | `""` | Appended to values in the tooltip and description, e.g. `" ms"`. |
| `formatX`, `formatY` | `(v: number) => string` | `formatNumber` | Tick and tooltip labels. |
| `logX`, `logY` | `boolean` | `false` | Log10 axes. Values at or below zero are clamped to `1e-9`. |
| `xMin`, `xMax`, `yMin`, `yMax` | `number` | fit the data | Fix an axis end (data units). By default y runs from 0 (or the lowest value) to 8% above the highest; a log y axis uses whole decades. |
| `xTicks`, `yTicks` | `number[]` | automatic | Tick values. Automatic: round numbers on linear axes, powers of ten on log y, the data's own x values on log x (up to 16 distinct values, thinned to 8). |
| `bands` | `Band[]` | none | Shaded x-ranges behind the data: `{ from, to, label? }`. Labels appear in the legend. |
| `width`, `height` | `number` | `680`, `320` | The viewBox. The SVG always fills its container's width; these set the aspect ratio and how large text looks. |
| `margin` | `Partial<Margin>` | `{ top: 14, right: 18, bottom: 46, left: 60 }` | Space for axis labels. |
| `hoverRadius` | `number` | `28` | How close (chart pixels) the pointer must be to a point. |
| `duration` | `number` | `450` | Data-change animation in ms; `0` turns it off. |
| `maxDots` | `number` | `12` | Dots are drawn on lines with at most this many points. |
| `className` | `string` | none | Added to the `<figure>`. |

`Series`: `{ name: string; points: [x, y][]; highlight?; dashed?; area?; curve?: "smooth" | "linear" | "step"; color?: string }`. Names must be unique within a chart. Points may be in any order; points with a non-finite coordinate are dropped.

### `<BarChart>`

| Prop | Type | Default | |
| --- | --- | --- | --- |
| `title` | `string` | required | Caption under the chart. |
| `bars` | `Bar[]` | required | `{ label; value; highlight?; detail?; color? }`. `detail` is shown under the chart while the bar is hovered. Labels must be unique. |
| `unit` | `string` | `""` | Appended to each value. |
| `digits` | `number` | `2` | Decimal places (ignored when `format` is given). |
| `format` | `(v: number) => string` | `toFixed(digits)` | Value labels. |
| `log` | `boolean` | `false` | Bar length grows with log10(1 + value); adds "Log scale." to the note. |
| `lowerIsBetter` | `boolean` | none | Adds "Shorter is better." (`true`) or "Longer is better." (`false`). |
| `note` | `string` | none | Any other note under the bars. |
| `labelWidth`, `trackWidth`, `valueWidth`, `rowHeight` | `number` | `290`, `330`, `110`, `32` | Layout in chart pixels. |
| `maxLabelChars` | `number` | `44` | Longer labels are cut with "…" (the full label stays in the accessible description). |
| `className` | `string` | none | Added to the `<figure>`. |

### `useTweenedLines(target, ms?)`

The hook `LineChart` uses: returns screen points that glide to `target` (ease-out cubic). Snaps when the number of lines or points changes, or under reduced motion.

## API: core (`@senova/smoothchart`)

| Export | What it does |
| --- | --- |
| `smoothPath(points)` | Monotone smooth SVG path through sorted screen points. Two points give a straight `M…L…`; fewer give `""`. |
| `monotoneSegments(points)` | The Fritsch-Carlson cubic segments themselves (`{ from, c1, c2, to }`), unrounded. |
| `linearPath`, `stepPath`, `linePath(points, curve)` | Straight, step and any-curve paths. |
| `areaPath(line, points, baselineY)` | Closes a line down to a baseline to fill the area under it. |
| `round2(v)` | Rounds to 0.01 (never `-0`); used for every printed coordinate. |
| `niceTicks(lo, hi, count = 5)` | Round tick values (steps of 1, 2, 2.5 or 5 × 10ⁿ) inside the range. |
| `logTicks(loExp, hiExp, max = 8)` | Powers of ten between two exponents, thinned to `max`. |
| `createScale(domain, range, { log?, clamp? })` | A data-to-pixel function with `domain`, `range`, `log` and `transform`. |
| `toAxisUnits(v, log)`, `LOG_FLOOR` | log10 with values ≤ 0 clamped to `1e-9`, or the value unchanged. |
| `layoutLineChart(options)` | Everything a line chart draws: `plot` area, `x` and `y` scales, ticks with pixel positions, band rectangles, each series' sorted `data` and screen `lines`. Takes the same layout options as `<LineChart>`. |
| `layoutBarChart(options)` | Bar rows: `y`, `fraction` of the track (0.004 to 1, so a tiny value still shows), cut `label`. |
| `nearestPoint(lines, x, y, radius = 28, skip?)` | The nearest point on any line within `radius`, as `{ series, index, distance }`, or `null`. `skip(series)` hides lines. Ties go to the earlier line. |
| `placeTooltip(anchor, lines, bounds)` | A tooltip box beside the point that stays inside the chart. |
| `easeOutCubic(t)`, `interpolateLines(from, to, t)`, `sameShape(a, b)` | The tweening maths. |
| `formatNumber(v)` | Short labels: `12k`, `1.5k`, `250`, `12.3`, `0.0123`. |
| `LINE_DEFAULTS`, `BAR_DEFAULTS` | The default sizes. |

Types: `Point`, `Series`, `Band`, `Bar`, `Curve`, `CubicSegment`, `Scale`, `Pick`, `Tick`, `Margin`, `LineLayout`, `LineLayoutOptions`, `BarLayout`, `BarLayoutOptions`, `BarRow`, `BandRect`, `TooltipBox`.

## Styling

Import `@senova/smoothchart/styles.css` once. Theme it with these custom properties, set anywhere above the chart (`:root`, a wrapper or the figure). Defaults follow the page's `color-scheme` through `light-dark()`: light unless the page declares `color-scheme: dark` (or `light dark` on a dark system).

| Property | Used for | Light | Dark |
| --- | --- | --- | --- |
| `--sc-ink` | labels and titles | `#1f2328` | `#e6e7ea` |
| `--sc-muted` | axis text, default line colour | `#6b7280` | `#9aa0aa` |
| `--sc-grid` | grid lines, tooltip border | `#e5e7eb` | `#2c2f35` |
| `--sc-accent` | highlighted line or bar | `#2563eb` | `#6ea8ff` |
| `--sc-bg` | tooltip and hover-ring fill | `#ffffff` | `#17181b` |
| `--sc-surface` | bands, bar tracks, legend hover | `#f3f4f6` | `#222429` |
| `--sc-surface-strong` | default bars | `#d1d5db` | `#3a3d44` |
| `--sc-dim-opacity` | other lines while one is hovered | `0.22` | |
| `--sc-duration` | bar animation | `0.45s` | |
| `--sc-ease` | bar easing | `cubic-bezier(0.16, 1, 0.3, 1)` | |
| `--sc-font` | font family | `inherit` | |

A series or bar with `color` sets `--sc-series-color` on its own elements. All classes start with `sc-`.

## Limits

- **SVG text scales with the chart.** The chart fills its container's width, so on a narrow phone screen the axis text gets small. Use a smaller `width` (and `height`) for narrow layouts.
- **Tooltip width is estimated** at about 7 px per character, because SVG text can't be measured before it's drawn. Very wide fonts may overrun the box.
- **Monotone means per segment.** Between two neighbouring points the curve stays within their y-range. It does not smooth noise; it only joins points without adding wiggles. Two points with the same x make a vertical jump.
- **Bars are for values of zero and up.** Negative values are drawn as zero.
- **Log axes can't show zero or negatives.** They are clamped to `1e-9`.
- **Keyboard:** legend buttons can be focused and toggled, and focusing one brings its line forward. Individual points can't be reached by keyboard; the full data is in the chart's accessible description instead (the `aria-label` lists every value).
- **Not tested here:** the React components are checked by type-checking and by hand in the example page (Chromium). The automated tests cover the core only.
- Built for dozens of lines with hundreds of points. Hover checks every visible point once per animation frame, which is fine at that size; thousands of points per line would want a spatial index.

## Dependencies

None at runtime. React (MIT) is an optional peer dependency, used only by `@senova/smoothchart/react`. `@types/react` (MIT) is a development dependency for type-checking.

## Licence

[AGPL-3.0-or-later](../../LICENSE). Copyright © 2026 Senova Systems LLC and contributors.
