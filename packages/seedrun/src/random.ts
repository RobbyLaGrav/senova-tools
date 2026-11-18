// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors

/** A seeded random generator. The same seed gives the same sequence on every machine and every run. */
export interface Rng {
  /** The seed this generator started from. */
  readonly seed: number
  /** A float in [0, 1). */
  next(): number
  /** A float in [lo, hi). */
  uniform(lo: number, hi: number): number
  /** An integer in [lo, hi), for integer bounds with lo < hi. */
  int(lo: number, hi: number): number
  /** A normal draw (Box-Muller), standard by default. */
  normal(mean?: number, sd?: number): number
  /** Shuffles an array in place (Fisher-Yates) and returns it. */
  shuffle<T>(items: T[]): T[]
  /** One element of a non-empty array. */
  pick<T>(items: readonly T[]): T
  /**
   * A new, independent generator for a named sub-task. It depends only on this generator's seed and the label, not on
   * how many numbers were drawn, so adding draws in one place never shifts the numbers somewhere else.
   */
  fork(label: string): Rng
}

const MAX_SEED = 0xffffffff

/** Throws unless `seed` is an integer from 0 to 2^32 - 1. */
export function assertSeed(seed: unknown, what = "seed"): asserts seed is number {
  if (typeof seed !== "number" || !Number.isInteger(seed) || seed < 0 || seed > MAX_SEED) {
    throw new RangeError(`${what} must be an integer from 0 to ${MAX_SEED}, got ${String(seed)}`)
  }
}

/**
 * Creates a mulberry32 generator. Mulberry32 is small, fast and passes the usual statistical batteries for simulation
 * work; it is not cryptographically secure.
 */
export function createRng(seed: number): Rng {
  assertSeed(seed)
  let state = seed >>> 0
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  // Box-Muller makes two draws at a time; the second is kept for the next call.
  let spare: number | null = null
  const standardNormal = (): number => {
    if (spare !== null) {
      const s = spare
      spare = null
      return s
    }
    let u = 0
    while (u === 0) u = next()
    const v = next()
    const r = Math.sqrt(-2 * Math.log(u))
    spare = r * Math.sin(2 * Math.PI * v)
    return r * Math.cos(2 * Math.PI * v)
  }
  const rng: Rng = {
    seed,
    next,
    uniform: (lo, hi) => lo + (hi - lo) * next(),
    int(lo, hi) {
      if (!Number.isInteger(lo) || !Number.isInteger(hi) || hi <= lo) {
        throw new RangeError(`int(lo, hi) needs integers with lo < hi, got ${lo}, ${hi}`)
      }
      return lo + Math.floor(next() * (hi - lo))
    },
    normal: (mean = 0, sd = 1) => mean + sd * standardNormal(),
    shuffle(items) {
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        const a = items[i] as (typeof items)[number]
        items[i] = items[j] as (typeof items)[number]
        items[j] = a
      }
      return items
    },
    pick(items) {
      if (items.length === 0) throw new RangeError("pick() needs a non-empty array")
      return items[Math.floor(next() * items.length)] as (typeof items)[number]
    },
    fork: (label) => createRng(deriveSeed(seed, label)),
  }
  return rng
}

/**
 * Derives a seed from a base seed and a label (FNV-1a over the label's UTF-8 bytes, mixed with the base seed and
 * finished with the murmur3 avalanche step). Stable across versions: changing it would change every published result,
 * so tests pin its output.
 */
export function deriveSeed(seed: number, label: string): number {
  assertSeed(seed)
  let h = 0x811c9dc5 ^ seed
  for (const byte of new TextEncoder().encode(label)) {
    h ^= byte
    h = Math.imul(h, 0x01000193)
  }
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}
