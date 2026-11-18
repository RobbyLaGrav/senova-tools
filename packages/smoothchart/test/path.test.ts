// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
import assert from "node:assert/strict"
import { test } from "node:test"

import { areaPath, linePath, monotoneSegments, round2, smoothPath, stepPath, type CubicSegment, type Point } from "../src/index.ts"

/** A point on a cubic Bézier at t. */
const at = (s: CubicSegment, t: number): Point => {
  const u = 1 - t
  const f = (i: 0 | 1): number => u * u * u * s.from[i] + 3 * u * u * t * s.c1[i] + 3 * u * t * t * s.c2[i] + t * t * t * s.to[i]
  return [f(0), f(1)]
}

/** Seeded random numbers (mulberry32), so a failing case can be reproduced. */
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const assertNoOvershoot = (pts: Point[]): void => {
  const segs = monotoneSegments(pts)
  assert.equal(segs.length, pts.length - 1)
  segs.forEach((s, i) => {
    const lo = Math.min(s.from[1], s.to[1]), hi = Math.max(s.from[1], s.to[1])
    const eps = 1e-9 * Math.max(1, Math.abs(lo), Math.abs(hi))
    for (let k = 0; k <= 64; k++) {
      const y = at(s, k / 64)[1]
      assert.ok(y >= lo - eps && y <= hi + eps, `segment ${i} leaves [${lo}, ${hi}] at t=${k / 64}: y=${y} (points ${JSON.stringify(pts)})`)
    }
  })
}

test("the curve passes through every point", () => {
  const pts: Point[] = [[0, 1], [1, 3], [2, 2], [4, 8], [5, 8]]
  const segs = monotoneSegments(pts)
  segs.forEach((s, i) => {
    assert.deepEqual(s.from, pts[i])
    assert.deepEqual(s.to, pts[i + 1])
    assert.deepEqual(at(s, 0), pts[i])
    assert.deepEqual(at(s, 1), pts[i + 1])
  })
})

test("monotone curves never overshoot: peaks, plateaus and steep jumps", () => {
  assertNoOvershoot([[0, 0], [1, 10], [2, 0]]) // a single peak
  assertNoOvershoot([[0, 0], [1, 0], [2, 10], [3, 10], [4, 10.1]]) // flat then a cliff then flat
  assertNoOvershoot([[0, 0], [1, 0.1], [2, 100], [3, 100.1]]) // tangent limit case (a² + b² > 9)
  assertNoOvershoot([[1, 5], [2, 4], [10, -3], [11, -3], [12, 9]])
})

test("monotone curves never overshoot: 500 random series", () => {
  const r = rng(42)
  for (let n = 0; n < 500; n++) {
    let x = 0
    const pts: Point[] = Array.from({ length: 3 + Math.floor(r() * 12) }, () => {
      x += 0.01 + r() * (r() < 0.2 ? 50 : 2)
      return [x, (r() - 0.5) * (r() < 0.3 ? 1000 : 10)]
    })
    assertNoOvershoot(pts)
  }
})

test("monotone data gives a monotone curve", () => {
  const pts: Point[] = [[0, 0], [1, 1], [2, 1.2], [3, 5], [4, 5.1], [5, 20]]
  let prev = -Infinity
  for (const s of monotoneSegments(pts)) {
    for (let k = 0; k <= 32; k++) {
      const y = at(s, k / 32)[1]
      assert.ok(y >= prev - 1e-12, `curve went down to ${y} after ${prev}`)
      prev = y
    }
  }
})

test("the path through two points is a straight line", () => {
  assert.equal(smoothPath([[0, 0], [10.123, 20.456]]), "M0,0L10.12,20.46")
})

test("fewer than two points draw nothing", () => {
  assert.equal(smoothPath([]), "")
  assert.equal(smoothPath([[1, 1]]), "")
  assert.deepEqual(monotoneSegments([[1, 1]]), [])
  assert.equal(stepPath([[1, 1]]), "")
})

test("a smooth path is cubic segments through the points", () => {
  assert.equal(smoothPath([[0, 0], [3, 3], [6, 0]]), "M0,0C1,1 2,3 3,3C4,3 5,1 6,0")
})

test("coordinates are rounded to 0.01 px and never print -0", () => {
  const d = smoothPath([[0.123456, 1.987654], [3.33333, 2.22222], [6.66666, -0.001]])
  for (const n of d.match(/-?\d+(\.\d+)?/g) ?? []) assert.ok(!/\.\d{3}/.test(n), `${n} has more than two decimals`)
  assert.ok(!d.includes("-0,") && !d.endsWith("-0"), d)
  assert.equal(round2(-0.001), 0)
  assert.ok(Object.is(round2(-0.001), 0))
})

test("the same input prints the same path (server and browser match)", () => {
  const pts: Point[] = [[60, 200.3333333], [180.5, 100.6666667], [300.25, 150.1]]
  assert.equal(smoothPath(pts), smoothPath(pts.map((p) => [p[0], p[1]])))
})

test("step, linear and area paths", () => {
  const pts: Point[] = [[0, 10], [5, 4], [10, 7]]
  assert.equal(linePath(pts, "step"), "M0,10H5V4H10V7")
  assert.equal(linePath(pts, "linear"), "M0,10L5,4L10,7")
  assert.equal(areaPath("M0,10L5,4L10,7", pts, 20), "M0,10L5,4L10,7L10,20L0,20Z")
  assert.equal(areaPath("", pts, 20), "")
})

test("two points with the same x do not produce NaN", () => {
  const d = smoothPath([[0, 0], [1, 1], [1, 2], [2, 3]])
  assert.ok(!d.includes("NaN") && !d.includes("Infinity"), d)
})
