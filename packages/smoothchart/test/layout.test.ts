// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
import assert from "node:assert/strict"
import { test } from "node:test"

import { createScale, easeOutCubic, interpolateLines, layoutBarChart, layoutLineChart, nearestPoint, sameShape, smoothPath, type Point } from "../src/index.ts"

test("scales map linearly, invert for an upward y axis, and clamp on request", () => {
  const x = createScale([0, 10], [60, 660])
  assert.equal(x(0), 60)
  assert.equal(x(5), 360)
  assert.equal(x(10), 660)
  const y = createScale([0, 100], [300, 0], { clamp: true })
  assert.equal(y(100), 0)
  assert.equal(y(200), 0)
  assert.equal(y(-5), 300)
})

test("log scales map decades evenly and clamp zero to the floor", () => {
  const x = createScale([0, 3], [0, 300], { log: true })
  assert.equal(x(1), 0)
  assert.equal(x(10), 100)
  assert.equal(x(1000), 300)
  assert.ok(Number.isFinite(x(0)))
})

test("a zero-width domain doesn't divide by zero", () => {
  const s = createScale([5, 5], [0, 100])
  assert.equal(s(5), 0)
})

test("line layout: y starts at zero with 8% headroom, points are sorted and in pixels", () => {
  const l = layoutLineChart({ series: [{ name: "a", points: [[2, 50], [0, 10], [1, 100]] }], width: 680, height: 320 })
  assert.deepEqual(l.y.domain, [0, 108])
  assert.deepEqual(l.data[0], [[0, 10], [1, 100], [2, 50]])
  assert.equal(l.lines[0]?.[0]?.[0], l.plot.left)
  assert.equal(l.lines[0]?.[2]?.[0], l.plot.right)
  assert.deepEqual(l.yTicks.map((t) => t.value), [0, 25, 50, 75, 100])
  for (const t of l.yTicks) assert.ok(t.pos <= l.plot.bottom && t.pos >= l.plot.top)
})

test("line layout: non-finite points are dropped and empty charts still lay out", () => {
  const l = layoutLineChart({ series: [{ name: "a", points: [[0, 1], [1, Number.NaN], [2, 3]] }] })
  assert.equal(l.data[0]?.length, 2)
  const empty = layoutLineChart({ series: [] })
  assert.deepEqual(empty.lines, [])
  assert.ok(empty.yTicks.length > 0)
})

test("line layout: log axes use whole decades", () => {
  const l = layoutLineChart({ series: [{ name: "a", points: [[1, 3], [8, 450], [64, 20000]] }], logX: true, logY: true })
  assert.deepEqual(l.y.domain, [0, 5])
  assert.deepEqual(l.yTicks.map((t) => t.value), [1, 10, 100, 1000, 10000, 100000])
  assert.deepEqual(l.xTicks.map((t) => t.value), [1, 8, 64]) // the data's own x values
})

test("line layout: fixed axis ends, custom ticks and bands clipped to the plot", () => {
  const l = layoutLineChart({
    series: [{ name: "a", points: [[0, 1], [10, 2]] }],
    yMin: 0,
    yMax: 4,
    xTicks: [0, 5, 10, 15],
    bands: [{ from: 8, to: 30, label: "moving" }],
  })
  assert.deepEqual(l.y.domain, [0, 4])
  assert.deepEqual(l.xTicks.map((t) => t.value), [0, 5, 10]) // 15 is off the axis
  const band = l.bands[0]
  assert.ok(band && band.x + band.width <= l.plot.right + 1e-9)
  assert.equal(band?.band.label, "moving")
})

test("bar layout: fractions of the longest bar, log option, tiny and negative values", () => {
  const l = layoutBarChart({ bars: [{ label: "a", value: 100 }, { label: "b", value: 50 }, { label: "c", value: 0 }, { label: "d", value: -3 }] })
  assert.deepEqual(l.rows.map((r) => r.fraction), [1, 0.5, 0.004, 0.004])
  assert.equal(l.width, 290 + 330 + 110)
  const log = layoutBarChart({ bars: [{ label: "a", value: 999 }, { label: "b", value: 9 }], log: true })
  assert.equal(log.rows[1]?.fraction, 1 / 3)
})

test("bar layout: long labels are cut", () => {
  const l = layoutBarChart({ bars: [{ label: "x".repeat(60), value: 1 }], maxLabelChars: 10 })
  assert.equal(l.rows[0]?.label, `${"x".repeat(9)}…`)
})

test("tweening moves every point part of the way and snaps when the shape changes", () => {
  const a: Point[][] = [[[0, 0], [10, 10]]]
  const b: Point[][] = [[[0, 10], [10, 0]]]
  assert.deepEqual(interpolateLines(a, b, 0.5), [[[0, 5], [10, 5]]])
  assert.deepEqual(interpolateLines(a, b, 1), b)
  const c: Point[][] = [[[0, 1]]]
  assert.equal(sameShape(a, c), false)
  assert.deepEqual(interpolateLines(a, c, 0.5), c)
  assert.equal(easeOutCubic(0), 0)
  assert.equal(easeOutCubic(1), 1)
  assert.ok(easeOutCubic(0.5) > 0.5)
  assert.equal(easeOutCubic(2), 1)
})

test("the README core example gives the documented path and pick", () => {
  const layout = layoutLineChart({ series: [{ name: "a", points: [[0, 1], [1, 3], [2, 2]] }] })
  assert.ok(smoothPath(layout.lines[0] ?? []).startsWith("M60,193.75C160.33,140.26 "))
  const hit = nearestPoint(layout.lines, 355, 40)
  assert.equal(hit?.series, 0)
  assert.equal(hit?.index, 1)
  assert.equal(Math.round((hit?.distance ?? 0) * 100) / 100, 9.02)
})
