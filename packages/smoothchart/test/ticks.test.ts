// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
import assert from "node:assert/strict"
import { test } from "node:test"

import { formatNumber, logTicks, niceTicks } from "../src/index.ts"

test("nice ticks use round steps inside the range", () => {
  assert.deepEqual(niceTicks(0, 100), [0, 20, 40, 60, 80, 100])
  assert.deepEqual(niceTicks(0, 10, 4), [0, 2.5, 5, 7.5, 10])
  assert.deepEqual(niceTicks(0.3, 9.7), [2, 4, 6, 8])
  assert.deepEqual(niceTicks(-50, 50, 4), [-50, -25, 0, 25, 50])
})

test("nice ticks have no floating-point noise", () => {
  for (const t of niceTicks(0, 0.7, 7)) assert.equal(t, Number(t.toFixed(10)))
  assert.deepEqual(niceTicks(0, 0.3, 3), [0, 0.1, 0.2, 0.3])
})

test("nice ticks: never more than count + 1, and every tick is in range", () => {
  for (const [lo, hi] of [[0, 1], [3, 1234], [-7.5, 0.25], [1e-6, 3e-6], [100, 100.5]] as const) {
    const ticks = niceTicks(lo, hi, 5)
    assert.ok(ticks.length >= 2 && ticks.length <= 6, `${lo}..${hi}: ${ticks}`)
    for (const t of ticks) assert.ok(t >= lo - 1e-9 && t <= hi + 1e-9, `${t} outside ${lo}..${hi}`)
  }
})

test("nice ticks: edge cases", () => {
  assert.deepEqual(niceTicks(5, 5), [5])
  assert.deepEqual(niceTicks(10, 0, 2), [0, 5, 10])
  assert.deepEqual(niceTicks(Number.NaN, 1), [])
  assert.deepEqual(niceTicks(0, Infinity), [])
})

test("log ticks are powers of ten, thinned to the maximum", () => {
  assert.deepEqual(logTicks(0, 3), [1, 10, 100, 1000])
  assert.deepEqual(logTicks(-2, 0), [0.01, 0.1, 1])
  assert.deepEqual(logTicks(0, 9, 5), [1, 100, 10000, 1000000, 100000000])
  assert.deepEqual(logTicks(0.5, 2.5), [10, 100])
})

test("number labels are short", () => {
  assert.equal(formatNumber(12345), "12k")
  assert.equal(formatNumber(1500), "1.5k")
  assert.equal(formatNumber(2000), "2k")
  assert.equal(formatNumber(250.4), "250")
  assert.equal(formatNumber(12.0), "12")
  assert.equal(formatNumber(12.34), "12.3")
  assert.equal(formatNumber(0.012345), "0.0123")
  assert.equal(formatNumber(-1500), "-1.5k")
  assert.equal(formatNumber(0), "0")
})
