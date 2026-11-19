// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Shared test fixtures: seeded random numbers and a tiny network built in code.

/** Seeded uniform [0, 1) (mulberry32). */
export function rng(seed: number): () => number {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A random dense network as model JSON: sizes[0] inputs, relu between layers, none at the end. */
export function randomModelJson(sizes: number[], seed: number, softmax = false): { inputSize: number; softmax: boolean; layers: object[] } {
  const r = rng(seed)
  return {
    inputSize: sizes[0]!,
    softmax,
    layers: sizes.slice(1).map((out, l) => ({
      weights: Array.from({ length: out }, () => Array.from({ length: sizes[l]! }, () => (r() * 2 - 1) / Math.sqrt(sizes[l]!))),
      bias: Array.from({ length: out }, () => (r() * 2 - 1) * 0.2),
      activation: l < sizes.length - 2 ? "relu" : "none",
    })),
  }
}

/** n random input vectors with values in [lo, hi). */
export function randomInputs(n: number, size: number, seed: number, lo = -1, hi = 1): number[][] {
  const r = rng(seed)
  return Array.from({ length: n }, () => Array.from({ length: size }, () => lo + (hi - lo) * r()))
}
