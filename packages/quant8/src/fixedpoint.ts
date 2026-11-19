// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Integer arithmetic shared by the TypeScript reference interpreter and the generated C. Every function here has a
// C twin in codegen.ts that computes the same bits; change one and you must change the other (the compile test checks).
//
// The scheme follows the widely used gemmlowp / TensorFlow Lite convention: a real multiplier M is stored as an int32
// Q31 fraction in [2^30, 2^31) and a power-of-two shift, and applied with a saturating rounding doubling high multiply
// followed by a rounding right shift.

export const INT32_MIN = -2147483648
export const INT32_MAX = 2147483647

/** Clamps to [lo, hi]. */
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

/** Rounds half away from zero, like C's round(). Math.round rounds half up, which differs for negatives. */
export const roundHalfAway = (x: number): number => (x < 0 ? -Math.round(-x) : Math.round(x))

/** A real multiplier as `multiplier * 2^(shift - 31)`; multiplier is 0 or in [2^30, 2^31). */
export interface QuantizedMultiplier {
  multiplier: number
  shift: number
}

/** Largest left shift allowed. Larger multipliers mean the output range is tiny next to the input range. */
export const MAX_LEFT_SHIFT = 30

/**
 * Splits a real multiplier into an int32 Q31 fraction and a shift. Values too small to matter (below 2^-32) become 0.
 * Throws RangeError for negative, non-finite or too-large multipliers.
 */
export function quantizeMultiplier(real: number): QuantizedMultiplier {
  if (!Number.isFinite(real) || real < 0) throw new RangeError(`multiplier ${real} must be a finite non-negative number`)
  if (real === 0) return { multiplier: 0, shift: 0 }
  // frexp: real = q * 2^shift with q in [0.5, 1).
  let shift = Math.floor(Math.log2(real)) + 1
  let q = real / 2 ** shift
  while (q >= 1) {
    q /= 2
    shift++
  }
  while (q < 0.5) {
    q *= 2
    shift--
  }
  let multiplier = Math.round(q * 2 ** 31)
  if (multiplier === 2 ** 31) {
    multiplier /= 2
    shift++
  }
  if (shift < -31) return { multiplier: 0, shift: 0 }
  if (shift > MAX_LEFT_SHIFT) {
    throw new RangeError(`multiplier ${real} needs a left shift of ${shift} (limit ${MAX_LEFT_SHIFT}); the output range is too narrow for the input range`)
  }
  return { multiplier, shift }
}

/** round((a * b) / 2^31), saturating the one overflow case (MIN * MIN). Exact ties round up (gemmlowp behaviour). */
export function saturatingRoundingDoublingHighMul(a: number, b: number): number {
  if (a === INT32_MIN && b === INT32_MIN) return INT32_MAX
  const ab = BigInt(a) * BigInt(b)
  const nudge = ab >= 0n ? 1n << 30n : 1n - (1n << 30n)
  // BigInt division truncates toward zero, exactly like C99 integer division.
  return Number((ab + nudge) / (1n << 31n))
}

/** x / 2^exponent rounded to nearest, ties away from zero. exponent in [0, 31]. */
export function roundingDivideByPOT(x: number, exponent: number): number {
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > 31) throw new RangeError(`exponent ${exponent} must be an integer in [0, 31]`)
  const p = 2 ** exponent
  const floor = Math.floor(x / p) // exact: dividing an int32 by a power of two loses nothing in a double
  const remainder = x - floor * p
  const threshold = Math.floor((p - 1) / 2) + (x < 0 ? 1 : 0)
  return floor + (remainder > threshold ? 1 : 0)
}

/** Applies a quantized multiplier to an int32 accumulator: round(acc * M), saturating at the int32 limits. */
export function multiplyByQuantizedMultiplier(acc: number, multiplier: number, shift: number): number {
  const left = shift > 0 ? shift : 0
  const right = shift > 0 ? 0 : -shift
  const x = clamp(acc * 2 ** left, INT32_MIN, INT32_MAX)
  return roundingDivideByPOT(saturatingRoundingDoublingHighMul(x, multiplier), right)
}

/**
 * One output value: rescale the accumulator, add the output zero point and saturate to [actMin, 127].
 * actMin is -128 for no activation, and the zero point for relu (so negatives clamp to real 0).
 */
export function requantize(acc: number, multiplier: number, shift: number, zeroPoint: number, actMin: number): number {
  return clamp(multiplyByQuantizedMultiplier(acc, multiplier, shift) + zeroPoint, actMin, 127)
}
