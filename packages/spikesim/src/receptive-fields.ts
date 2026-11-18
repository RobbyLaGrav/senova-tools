// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors

/** How each neuron listens to the sensor. */
export interface ReceptiveFieldConfig {
  /** Which coordinate the neurons are tuned to (and the decoder reports). Default "x". */
  axis: "x" | "y"
  /** Width (standard deviation) of each Gaussian tuning curve, in pixels. Default 1. */
  sigma: number
  /** Peak weight: what one event at a neuron's preferred position adds to its potential. Default 0.16. */
  gain: number
  /**
   * Each neuron's preferred position along `axis`, in pixels. Default: evenly spaced, neuron n at
   * (n + 0.5) x extent / count.
   */
  preferred?: readonly number[]
  /** Replace the Gaussian with any weight from pixel (x, y) to a neuron. `preferred` is still used by the decoder. */
  weight?: (neuron: number, x: number, y: number) => number
}

/** Evenly spaced preferred positions across `extent` pixels. */
export function evenlySpaced(count: number, extent: number): Float64Array {
  return Float64Array.from({ length: count }, (_, n) => ((n + 0.5) * extent) / count)
}

/**
 * The full weight matrix, row-major by pixel: `weights[pixel * count + neuron]`. Built once, so each event costs
 * exactly `count` additions.
 */
export function buildWeights(width: number, height: number, preferred: Float64Array, rf: ReceptiveFieldConfig): Float64Array {
  const count = preferred.length
  const w = new Float64Array(width * height * count)
  const twoS2 = 2 * rf.sigma * rf.sigma
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const row = (y * width + x) * count
      const coord = (rf.axis === "x" ? x : y) + 0.5
      for (let n = 0; n < count; n++) {
        w[row + n] = rf.weight ? rf.weight(n, x, y) : rf.gain * Math.exp(-((coord - (preferred[n] ?? 0)) ** 2) / twoS2)
      }
    }
  }
  return w
}
