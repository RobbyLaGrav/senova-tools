// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
import assert from "node:assert/strict"
import { test } from "node:test"

import { stableStringify } from "../src/index.ts"

test("key order doesn't change the bytes", () => {
  assert.equal(stableStringify({ b: 1, a: { d: 2, c: 3 } }), stableStringify({ a: { c: 3, d: 2 }, b: 1 }))
  assert.equal(stableStringify({ b: 1, a: 2 }), '{\n  "a": 2,\n  "b": 1\n}\n')
})

test("typed arrays become arrays, -0 becomes 0, undefined properties are dropped", () => {
  assert.equal(stableStringify({ x: Float64Array.of(1.5, -0), y: undefined }), '{\n  "x": [\n    1.5,\n    0\n  ]\n}\n')
})

test("values JSON would silently change are refused, naming the path", () => {
  assert.throws(() => stableStringify({ a: [1, Number.NaN] }), /\$\.a\[1\] is NaN/)
  assert.throws(() => stableStringify({ a: Infinity }), /non-finite/)
  assert.throws(() => stableStringify([undefined]), /\$\[0\] is undefined/)
  assert.throws(() => stableStringify({ m: new Map() }), /\$\.m is a Map/)
  assert.throws(() => stableStringify({ d: new Date(0) }), /Date/)
  assert.throws(() => stableStringify({ n: 1n }), /bigint/)
  assert.throws(() => stableStringify({ f: () => 1 }), /function/)
})
