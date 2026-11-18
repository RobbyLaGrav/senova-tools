// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
import assert from "node:assert/strict"
import { test } from "node:test"

import { pickHeadline, within } from "../src/index.ts"

const dense = { setting: "dense", ops: 4608, rms: 0.3 }
const settings = [
  { setting: "exact", ops: 4100, rms: 0.3 },
  { setting: "low", ops: 1500, rms: 0.32 },
  { setting: "mid", ops: 900, rms: 0.33 },
  { setting: "high", ops: 400, rms: 0.45 },
]
const rule = {
  label: "largest saving within 10 % extra error",
  score: (s: (typeof settings)[number]) => dense.ops / s.ops,
  where: (s: (typeof settings)[number]) => within(s.rms, dense.rms, { pct: 10, better: "lower" }),
}

test("the rule picks the largest saving that stays within the error budget", () => {
  const h = pickHeadline(settings, rule)
  assert.equal(h?.item.setting, "mid")
  assert.equal(h?.index, 2)
  assert.equal(h?.rule, "largest saving within 10 % extra error")
})

test("a re-run that pushes a setting over budget changes the pick", () => {
  const rerun = settings.map((s) => (s.setting === "mid" ? { ...s, rms: 0.34 } : s))
  assert.equal(pickHeadline(rerun, rule)?.item.setting, "low")
})

test("no qualifying setting returns null, so the page must say so", () => {
  const worse = settings.map((s) => ({ ...s, rms: 0.5 }))
  assert.equal(pickHeadline(worse, rule), null)
  assert.equal(pickHeadline([], rule), null)
})

test("goal min, ties go to the first item, and bad scores throw", () => {
  const items = [{ v: 3 }, { v: 1 }, { v: 1 }]
  assert.equal(pickHeadline(items, { label: "lowest", score: (i) => i.v, goal: "min" })?.index, 1)
  assert.equal(pickHeadline(items, { label: "highest", score: (i) => i.v })?.index, 0)
  assert.throws(() => pickHeadline(items, { label: "broken", score: () => Number.NaN }), /broken/)
})

test("within: lower and higher is better, exact edges, negatives", () => {
  assert.equal(within(0.33, 0.3, { pct: 10, better: "lower" }), true) // exactly 10 % worse, despite float error
  assert.equal(within(0.331, 0.3, { pct: 10, better: "lower" }), false)
  assert.equal(within(0.1, 0.3, { pct: 0, better: "lower" }), true) // better always passes
  assert.equal(within(90, 100, { pct: 10, better: "higher" }), true)
  assert.equal(within(89.9, 100, { pct: 10, better: "higher" }), false)
  assert.equal(within(-9, -10, { pct: 10, better: "lower" }), true)
  assert.throws(() => within(1, 1, { pct: -1, better: "lower" }), RangeError)
})
