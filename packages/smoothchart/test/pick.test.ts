// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
import assert from "node:assert/strict"
import { test } from "node:test"

import { nearestPoint, placeTooltip, type Point } from "../src/index.ts"

const lines: Point[][] = [
  [[0, 0], [100, 0], [200, 0]],
  [[0, 50], [100, 20], [200, 50]],
]

test("picks the nearest point across lines", () => {
  assert.deepEqual(nearestPoint(lines, 98, 15), { series: 1, index: 1, distance: Math.sqrt(29) })
  assert.deepEqual(nearestPoint(lines, 101, 3), { series: 0, index: 1, distance: Math.sqrt(10) })
})

test("nothing within the radius picks nothing", () => {
  assert.equal(nearestPoint(lines, 50, 200), null)
  assert.equal(nearestPoint(lines, 130, 0, 28), null)
  assert.notEqual(nearestPoint(lines, 127, 0, 28), null)
})

test("hidden lines are skipped", () => {
  const pick = nearestPoint(lines, 100, 5, 28, (s) => s === 0)
  assert.equal(pick?.series, 1)
  assert.equal(nearestPoint(lines, 100, 5, 28, () => true), null)
})

test("on a tie the earlier line wins", () => {
  const tie: Point[][] = [[[0, 0]], [[0, 0]]]
  assert.equal(nearestPoint(tie, 0, 0)?.series, 0)
})

test("no lines, no pick", () => {
  assert.equal(nearestPoint([], 0, 0), null)
  assert.equal(nearestPoint([[]], 0, 0), null)
})

test("the tooltip flips left near the right edge and stays inside the plot", () => {
  const bounds = { right: 660, top: 14, bottom: 274 }
  const right = placeTooltip([100, 100], ["Series", "1.2 at 3"], bounds)
  assert.equal(right.x, 112)
  const left = placeTooltip([640, 100], ["Series", "1.2 at 3"], bounds)
  assert.ok(left.x + left.width <= 640)
  const top = placeTooltip([100, 0], ["a"], bounds)
  assert.equal(top.y, 14)
  const bottom = placeTooltip([100, 274], ["a"], bounds)
  assert.ok(bottom.y + bottom.height <= 274)
  assert.ok(placeTooltip([0, 0], ["x".repeat(40)], bounds).width > 120)
})
