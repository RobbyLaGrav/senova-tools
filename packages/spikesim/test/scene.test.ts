// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
import assert from "node:assert/strict"
import { test } from "node:test"

import { createRandom, createSpotScene, formatRate, formatRatio } from "../src/index.ts"

test("the spot is brightest at its centre and falls to the background far away", () => {
  const scene = createSpotScene({ speedHz: 0, background: 0.1 })
  const c = scene.target()!
  assert.ok(Math.abs(scene.brightness(c.x, c.y) - 1) < 1e-12)
  assert.ok(Math.abs(scene.brightness(c.x + 100, c.y) - 0.1) < 1e-12)
})

test("changing speed mid-run continues the path without a jump", () => {
  const scene = createSpotScene({ speedHz: 0.35 })
  for (let i = 0; i < 500; i++) scene.advance(1)
  const before = scene.target()!
  scene.speedHz = 1.1
  scene.advance(1)
  const after = scene.target()!
  assert.ok(Math.hypot(after.x - before.x, after.y - before.y) < 0.1)
})

test("a still spot stays put", () => {
  const scene = createSpotScene({ speedHz: 0 })
  const a = scene.target()!
  for (let i = 0; i < 100; i++) scene.advance(1)
  assert.deepEqual(scene.target(), a)
})

test("bad spot options throw", () => {
  assert.throws(() => createSpotScene({ radius: 0 }), RangeError)
  assert.throws(() => createSpotScene({ background: 0 }), RangeError)
})

test("the random generator is seeded and in [0, 1)", () => {
  const a = createRandom(42)
  const b = createRandom(42)
  for (let i = 0; i < 1000; i++) {
    const x = a()
    assert.equal(x, b())
    assert.ok(x >= 0 && x < 1)
  }
  assert.notEqual(createRandom(1)(), createRandom(2)())
})

test("rates and ratios format for display", () => {
  assert.equal(formatRate(830.4), "830")
  assert.equal(formatRate(12_400), "12.4 k")
  assert.equal(formatRate(12_288_000), "12.3 M")
  assert.equal(formatRate(Infinity), "∞")
  assert.equal(formatRatio(Infinity), "∞×")
  assert.equal(formatRatio(42.25), "42.3×")
  assert.equal(formatRatio(1234.4), "1234×")
})

test("the README example runs and prints the counters", async () => {
  const { execFile } = await import("node:child_process")
  const { fileURLToPath } = await import("node:url")
  const script = fileURLToPath(new URL("../examples/headless.ts", import.meta.url))
  const out = await new Promise<string>((resolve, reject) =>
    execFile(process.execPath, [script], (err, stdout) => (err ? reject(err) : resolve(stdout))),
  )
  assert.match(out, /events\/s\s+\d/)
  assert.match(out, /still: events\/s 0, less work ∞×/)
})
