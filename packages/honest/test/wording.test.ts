// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
import assert from "node:assert/strict"
import { test } from "node:test"

import { compare, describeChange, formatNumber, percentChange, times } from "../src/index.ts"

test("compare: a win on a lower-is-better metric cuts the error", () => {
  const c = compare(0.21, 0.34, { better: "lower", unit: "mm" })
  assert.equal(c.text, "cut the error to 0.21 mm from 0.34 mm")
  assert.equal(c.outcome, "better")
  assert.equal(c.beats, true)
  assert.equal(Math.round(c.change ?? 0), -38)
})

test("compare: a loss says \"did not beat\", with both numbers", () => {
  const c = compare(0.41, 0.34, { better: "lower", unit: "mm", against: "the usual fix" })
  assert.equal(c.text, "did not beat the usual fix (0.41 mm against 0.34 mm)")
  assert.equal(c.outcome, "worse")
  assert.equal(c.beats, false)
})

test("compare: a re-run that flips the result flips the sentence", () => {
  const sentence = (ours: number) => `The network ${compare(ours, 0.3, { better: "lower", unit: "mm" }).text}.`
  assert.equal(sentence(0.25), "The network cut the error to 0.25 mm from 0.30 mm.")
  assert.equal(sentence(0.35), "The network did not beat the baseline (0.35 mm against 0.30 mm).")
})

test("compare: higher-is-better raises the score, and losing still says did not beat", () => {
  assert.equal(compare(91.2, 88, { better: "higher", digits: 1, metric: "accuracy", unit: "%" }).text, "raised the accuracy to 91.2 % from 88.0 %")
  assert.equal(compare(87.9, 88, { better: "higher", digits: 1 }).text, "did not beat the baseline (87.9 against 88.0)")
})

test("compare: values that print the same are reported as the same, never as a win", () => {
  const c = compare(0.3449, 0.3351, { better: "lower", unit: "mm" })
  assert.equal(c.outcome, "same")
  assert.equal(c.beats, false)
  assert.equal(c.text, "matched the baseline (both 0.34 mm)")
  assert.equal(compare(0.30, 0.31, { better: "lower", tolerance: 0.02 }).outcome, "same")
})

test("compare: rejects NaN, Infinity and a missing direction", () => {
  assert.throws(() => compare(Number.NaN, 1, { better: "lower" }), RangeError)
  assert.throws(() => compare(1, Infinity, { better: "higher" }), RangeError)
  assert.throws(() => compare(1, 2, {} as never), TypeError)
  assert.equal(compare(1, 0, { better: "higher" }).change, null)
})

test("formatNumber is fixed, locale-free and never prints -0", () => {
  assert.equal(formatNumber(1234567.891, { group: true }), "1,234,567.89")
  assert.equal(formatNumber(-1234.5, { digits: 1, group: true, unit: "J" }), "-1,234.5 J")
  assert.equal(formatNumber(-0.001), "0.00")
  assert.equal(formatNumber(2.5, { digits: 0 }), "3")
  assert.throws(() => formatNumber(Number.NaN), RangeError)
})

test("percentChange and describeChange", () => {
  assert.equal(percentChange(110, 100), 10)
  assert.equal(percentChange(-90, -100), 10) // relative to the size of the reference
  assert.throws(() => percentChange(1, 0), RangeError)
  assert.equal(describeChange(110, 100), "10% more")
  assert.equal(describeChange(88, 100, { down: "lower" }), "12% lower")
  assert.equal(describeChange(100.2, 100), "no change")
  assert.equal(describeChange(112.34, 100, { digits: 1, spaceBeforePercent: true }), "12.3 % more")
})

test("times: N× less or more, honest about rounding to 1", () => {
  assert.equal(times(600, 4608), "7.7× less")
  assert.equal(times(4608, 600, { style: "times" }), "7.7 times more")
  assert.equal(times(100, 700), "7× less") // trailing .0 dropped
  assert.equal(times(10, 70, { less: "fewer" }), "7× fewer")
  assert.equal(times(100, 102), "about the same")
  assert.throws(() => times(0, 5), RangeError)
  assert.throws(() => times(-1, 5), RangeError)
})
