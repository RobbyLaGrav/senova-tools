// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
import assert from "node:assert/strict"
import { test } from "node:test"

import { createRng, deriveSeed } from "../src/index.ts"

test("createRng reproduces the original research generator exactly", () => {
  // Values produced by the mulberry32 + Box-Muller code Seedrun was generalised from, seed 42.
  const r = createRng(42)
  assert.deepEqual(
    [r.next(), r.next(), r.next(), r.normal(), r.normal(), r.normal()],
    [0.6011037519201636, 0.44829055899754167, 0.8524657934904099, 0.40743774041311, 0.7973353652296515, -0.1647039026273102],
  )
})

test("same seed, same sequence; different seed, different sequence", () => {
  const draw = (seed: number) => {
    const r = createRng(seed)
    return Array.from({ length: 50 }, () => r.next())
  }
  assert.deepEqual(draw(7), draw(7))
  assert.notDeepEqual(draw(7), draw(8))
})

test("deriveSeed is pinned: changing it would change every published result", () => {
  assert.equal(deriveSeed(0, ""), 2872998923)
  assert.equal(deriveSeed(1, "a"), 3873127206)
  assert.equal(deriveSeed(2026, "pi"), 3744696576)
  assert.equal(deriveSeed(4294967295, "héllo"), 1341280091)
  assert.notEqual(deriveSeed(1, "train"), deriveSeed(1, "test"))
  assert.notEqual(deriveSeed(1, "train"), deriveSeed(2, "train"))
})

test("fork depends on the seed and label, not on how many draws were made", () => {
  const a = createRng(5)
  const b = createRng(5)
  for (let i = 0; i < 100; i++) b.next()
  assert.equal(a.fork("noise").next(), b.fork("noise").next())
  assert.notEqual(a.fork("noise").next(), a.fork("signal").next())
})

test("uniform, int, normal, shuffle and pick stay in range", () => {
  const r = createRng(3)
  for (let i = 0; i < 1000; i++) {
    const u = r.uniform(-2, 5)
    assert.ok(u >= -2 && u < 5)
    const k = r.int(3, 9)
    assert.ok(Number.isInteger(k) && k >= 3 && k < 9)
  }
  const draws = Array.from({ length: 20000 }, () => r.normal(10, 2))
  const m = draws.reduce((s, v) => s + v, 0) / draws.length
  const sd = Math.sqrt(draws.reduce((s, v) => s + (v - m) ** 2, 0) / draws.length)
  assert.ok(Math.abs(m - 10) < 0.05 && Math.abs(sd - 2) < 0.05, `mean ${m}, sd ${sd}`)
  const items = [1, 2, 3, 4, 5, 6]
  assert.deepEqual([...r.shuffle([...items])].sort(), items)
  assert.ok(items.includes(r.pick(items)))
})

test("bad seeds and arguments are refused", () => {
  for (const bad of [-1, 1.5, 2 ** 32, Number.NaN]) assert.throws(() => createRng(bad), RangeError)
  const r = createRng(1)
  assert.throws(() => r.int(5, 5), RangeError)
  assert.throws(() => r.pick([]), RangeError)
})
