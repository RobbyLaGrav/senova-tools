// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
import assert from "node:assert/strict"
import { test } from "node:test"

import {
  chooseQParams,
  INT32_MAX,
  INT32_MIN,
  multiplyByQuantizedMultiplier,
  quantizeMultiplier,
  quantizeValue,
  requantize,
  roundHalfAway,
  roundingDivideByPOT,
  saturatingRoundingDoublingHighMul,
} from "../src/index.ts"

test("quantizeMultiplier: Q31 fraction in [2^30, 2^31) and a shift", () => {
  assert.deepEqual(quantizeMultiplier(0.5), { multiplier: 2 ** 30, shift: 0 })
  assert.deepEqual(quantizeMultiplier(1), { multiplier: 2 ** 30, shift: 1 })
  assert.deepEqual(quantizeMultiplier(0.75), { multiplier: 3 * 2 ** 29, shift: 0 })
  assert.deepEqual(quantizeMultiplier(0), { multiplier: 0, shift: 0 })
  // Just below 1: rounds up to 2^31, which must renormalise rather than overflow int32.
  assert.deepEqual(quantizeMultiplier(1 - 2 ** -40), { multiplier: 2 ** 30, shift: 1 })
  for (const real of [1e-9, 3.7e-4, 0.0123, 0.999, 1.5, 300, 2 ** 29]) {
    const { multiplier, shift } = quantizeMultiplier(real)
    assert.ok(multiplier >= 2 ** 30 && multiplier < 2 ** 31, `${real}: ${multiplier}`)
    assert.ok(Math.abs(multiplier * 2 ** (shift - 31) - real) / real < 2 ** -30, `${real} round-trips`)
  }
})

test("quantizeMultiplier: tiny becomes 0, huge or invalid throws", () => {
  assert.deepEqual(quantizeMultiplier(2 ** -40), { multiplier: 0, shift: 0 })
  assert.throws(() => quantizeMultiplier(2 ** 31), /left shift of 32/)
  assert.throws(() => quantizeMultiplier(-1), RangeError)
  assert.throws(() => quantizeMultiplier(Number.NaN), RangeError)
  assert.throws(() => quantizeMultiplier(Infinity), RangeError)
})

test("saturatingRoundingDoublingHighMul: rounding, signs and the MIN * MIN saturation", () => {
  assert.equal(saturatingRoundingDoublingHighMul(INT32_MIN, INT32_MIN), INT32_MAX)
  assert.equal(saturatingRoundingDoublingHighMul(INT32_MAX, INT32_MAX), INT32_MAX - 1)
  assert.equal(saturatingRoundingDoublingHighMul(INT32_MIN, INT32_MAX), -INT32_MAX)
  assert.equal(saturatingRoundingDoublingHighMul(100, 2 ** 30), 50)
  assert.equal(saturatingRoundingDoublingHighMul(3, 2 ** 30), 2) // 1.5 -> 2
  assert.equal(saturatingRoundingDoublingHighMul(-3, 2 ** 30), -1) // -1.5 -> -1: exact negative ties go up, as in gemmlowp
  assert.equal(saturatingRoundingDoublingHighMul(-5, 2 ** 29), -1) // -1.25 -> -1
  assert.equal(saturatingRoundingDoublingHighMul(-7, 2 ** 29), -2) // -1.75 -> -2
  assert.equal(saturatingRoundingDoublingHighMul(0, INT32_MIN), 0)
})

test("roundingDivideByPOT: ties away from zero on both sides", () => {
  assert.equal(roundingDivideByPOT(5, 1), 3)
  assert.equal(roundingDivideByPOT(-5, 1), -3)
  assert.equal(roundingDivideByPOT(-4, 1), -2)
  assert.equal(roundingDivideByPOT(7, 2), 2)
  assert.equal(roundingDivideByPOT(-7, 2), -2)
  assert.equal(roundingDivideByPOT(-6, 2), -2)
  assert.equal(roundingDivideByPOT(9, 0), 9)
  assert.equal(roundingDivideByPOT(INT32_MIN, 31), -1)
  assert.equal(roundingDivideByPOT(INT32_MAX, 31), 1)
  assert.throws(() => roundingDivideByPOT(1, 32), RangeError)
})

test("multiplyByQuantizedMultiplier matches round(acc * real) within one step", () => {
  let seed = 7
  const next = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32)
  for (let k = 0; k < 2000; k++) {
    const real = 2 ** (next() * 20 - 18)
    const acc = Math.round((next() * 2 - 1) * Math.min(2 ** 30, 2 ** 31 / real / 2))
    const { multiplier, shift } = quantizeMultiplier(real)
    const got = multiplyByQuantizedMultiplier(acc, multiplier, shift)
    assert.ok(Math.abs(got - acc * real) <= 1, `acc ${acc} * ${real}: got ${got}`)
  }
})

test("multiplyByQuantizedMultiplier saturates instead of wrapping when the left shift overflows", () => {
  // 1024 = 2^30 (Q31 0.5) with shift 11: acc << 11 saturates to the int32 limit first, then the 0.5 applies.
  const { multiplier, shift } = quantizeMultiplier(1024)
  assert.deepEqual({ multiplier, shift }, { multiplier: 2 ** 30, shift: 11 })
  assert.equal(multiplyByQuantizedMultiplier(2 ** 29, multiplier, shift), 2 ** 30)
  assert.equal(multiplyByQuantizedMultiplier(-(2 ** 29), multiplier, shift), -(2 ** 30))
  assert.equal(requantize(2 ** 29, multiplier, shift, 0, -128), 127)
})

test("requantize: saturates to int8 and to the relu floor, with a negative zero point", () => {
  const { multiplier, shift } = quantizeMultiplier(0.5)
  assert.equal(requantize(1_000_000, multiplier, shift, -128, -128), 127)
  assert.equal(requantize(-1_000_000, multiplier, shift, -128, -128), -128)
  assert.equal(requantize(100, multiplier, shift, -20, -128), 30) // 50 + (-20)
  assert.equal(requantize(-100, multiplier, shift, -20, -128), -70)
  assert.equal(requantize(-100, multiplier, shift, -20, -20), -20) // relu: clamped at the zero point (real 0)
  assert.equal(requantize(INT32_MAX, multiplier, shift, 127, -128), 127)
  assert.equal(requantize(INT32_MIN, multiplier, shift, -128, -128), -128)
  assert.equal(requantize(12345, 0, 0, 5, -128), 5) // zero multiplier: only the zero point
})

test("chooseQParams: zero ranges, one-sided ranges and symmetric mode", () => {
  assert.deepEqual(chooseQParams(0, 0, "asymmetric"), { scale: 1, zeroPoint: -128 })
  assert.deepEqual(chooseQParams(0, 0, "symmetric"), { scale: 1, zeroPoint: 0 })
  const pos = chooseQParams(0.5, 2.55, "asymmetric") // range widened to include 0
  assert.equal(pos.zeroPoint, -128)
  assert.ok(Math.abs(pos.scale - 0.01) < 1e-15)
  // All-negative range still includes 0, so the zero point sits at the top.
  const neg = chooseQParams(-2.55, -1, "asymmetric")
  assert.equal(neg.zeroPoint, 127)
  assert.ok(Math.abs(neg.scale - 0.01) < 1e-15)
  assert.deepEqual(chooseQParams(-1, 2, "symmetric"), { scale: 2 / 127, zeroPoint: 0 })
  const p = chooseQParams(-1, 3, "asymmetric")
  assert.equal(p.zeroPoint, -64)
  assert.equal(quantizeValue(0, p), p.zeroPoint) // real 0 is exact
  assert.equal(quantizeValue(1e9, p), 127)
  assert.equal(quantizeValue(-1e9, p), -128)
  assert.throws(() => chooseQParams(2, 1, "asymmetric"), /invalid range/)
})

test("roundHalfAway rounds like C round()", () => {
  assert.deepEqual([2.5, -2.5, 0.49, -0.5, -1.2].map(roundHalfAway), [3, -3, 0, -1, -1])
})
