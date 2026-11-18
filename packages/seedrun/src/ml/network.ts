// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// A small dense network (tanh or relu hidden layers, linear output) trained with Adam on mean squared error. Plain
// loops over Float64Array, no dependencies: slow next to a GPU library, but every number is reproducible from the seeds.
import { createRng } from "../random.ts"

export type Activation = "tanh" | "relu"

/** A dense network. Weights of layer l are an n x m matrix, row-major: `W[l][i * m + j]` links input i to output j. */
export interface Network {
  /** Layer widths, input first: `[inputs, hidden..., outputs]`. */
  readonly sizes: readonly number[]
  readonly W: Float64Array[]
  readonly b: Float64Array[]
  readonly activation: Activation
}

export interface NetworkOptions {
  /** Seed for the initial weights. Default 1. */
  seed?: number
  /** Hidden-layer activation. Default "tanh". */
  activation?: Activation
}

export interface TrainOptions {
  /** Passes over the data. Default 25. */
  epochs?: number
  /** Rows per Adam step. Default 32. */
  batch?: number
  /** Initial learning rate. Default 2e-3. */
  lr?: number
  /** Learning rate multiplier per epoch (rate = lr * lrDecay^epoch). Default 0.88. */
  lrDecay?: number
  /** Seed for the shuffle order. Default 7. */
  seed?: number
}

type Row = ArrayLike<number>

/**
 * Creates a network with sizes like `[52, 64, 64, 2]`. Weights are normal draws scaled by sqrt(1/n) for tanh (LeCun)
 * or sqrt(2/n) for relu (He); biases start at zero.
 */
export function mlp(sizes: readonly number[], options: NetworkOptions = {}): Network {
  const { seed = 1, activation = "tanh" } = options
  if (sizes.length < 2 || sizes.some((s) => !Number.isInteger(s) || s < 1)) {
    throw new RangeError(`sizes must be two or more positive integers, got [${sizes.join(", ")}]`)
  }
  if (activation !== "tanh" && activation !== "relu") throw new RangeError(`activation must be "tanh" or "relu"`)
  const r = createRng(seed)
  const W: Float64Array[] = []
  const b: Float64Array[] = []
  for (let l = 0; l < sizes.length - 1; l++) {
    const n = sizes[l] as number
    const m = sizes[l + 1] as number
    const w = new Float64Array(n * m)
    const s = Math.sqrt((activation === "relu" ? 2 : 1) / n)
    for (let i = 0; i < w.length; i++) w[i] = r.normal() * s
    W.push(w)
    b.push(new Float64Array(m))
  }
  return { sizes: [...sizes], W, b, activation }
}

/** Forward pass for one input. Returns every layer's output, input first (what backpropagation needs). */
export function forward(net: Network, x: Row): Float64Array[] {
  if (x.length !== net.sizes[0]) throw new RangeError(`input has ${x.length} values, the network expects ${net.sizes[0]}`)
  const acts = [Float64Array.from(x)]
  const L = net.W.length
  for (let l = 0; l < L; l++) {
    const n = net.sizes[l] as number
    const m = net.sizes[l + 1] as number
    const w = net.W[l] as Float64Array
    const bias = net.b[l] as Float64Array
    const prev = acts[l] as Float64Array
    const out = new Float64Array(m)
    for (let j = 0; j < m; j++) {
      let s = bias[j] as number
      for (let i = 0; i < n; i++) s += (prev[i] as number) * (w[i * m + j] as number)
      out[j] = l < L - 1 ? (net.activation === "relu" ? (s > 0 ? s : 0) : Math.tanh(s)) : s
    }
    acts.push(out)
  }
  return acts
}

/** The network's output for one input. */
export function predict(net: Network, x: Row): Float64Array {
  return forward(net, x)[net.W.length] as Float64Array
}

/**
 * Trains in place with Adam (beta1 0.9, beta2 0.999, eps 1e-8) on mean squared error, shuffling the rows each epoch
 * with a seeded generator. X and Y are rows of inputs and targets, best standardised first (see `scaler`). Returns the
 * mean training loss of each epoch, for a learning curve.
 */
export function train(net: Network, X: readonly Row[], Y: readonly Row[], options: TrainOptions = {}): number[] {
  const { epochs = 25, batch = 32, lr = 2e-3, seed = 7, lrDecay = 0.88 } = options
  if (X.length === 0 || X.length !== Y.length) throw new RangeError(`X and Y need the same, non-zero number of rows (${X.length} and ${Y.length})`)
  if (!Number.isInteger(batch) || batch < 1) throw new RangeError(`batch must be a positive integer, got ${batch}`)
  const outputs = net.sizes[net.sizes.length - 1] as number
  for (const y of Y) if (y.length !== outputs) throw new RangeError(`target rows need ${outputs} values, got ${y.length}`)
  const r = createRng(seed)
  const L = net.W.length
  const zeros = (a: Float64Array[]) => a.map((x) => new Float64Array(x.length))
  const mW = zeros(net.W), vW = zeros(net.W), gW = zeros(net.W)
  const mb = zeros(net.b), vb = zeros(net.b), gb = zeros(net.b)
  const b1 = 0.9, b2 = 0.999, eps = 1e-8
  let t = 0
  const idx = Array.from(X, (_, i) => i)
  const curve: number[] = []
  for (let ep = 0; ep < epochs; ep++) {
    r.shuffle(idx)
    let lossSum = 0
    const rate = lr * lrDecay ** ep
    for (let s = 0; s < idx.length; s += batch) {
      const end = Math.min(s + batch, idx.length)
      const bs = end - s
      for (const g of gW) g.fill(0)
      for (const g of gb) g.fill(0)
      for (let k = s; k < end; k++) {
        const row = idx[k] as number
        const acts = forward(net, X[row] as Row)
        const y = Y[row] as Row
        const top = acts[L] as Float64Array
        let delta = new Float64Array(top.length)
        for (let j = 0; j < delta.length; j++) {
          const e = (top[j] as number) - (y[j] as number)
          lossSum += e * e
          delta[j] = (2 * e) / (bs * delta.length)
        }
        for (let l = L - 1; l >= 0; l--) {
          const n = net.sizes[l] as number
          const m = net.sizes[l + 1] as number
          const prev = acts[l] as Float64Array
          const w = net.W[l] as Float64Array
          const gw = gW[l] as Float64Array
          const gbl = gb[l] as Float64Array
          for (let i = 0; i < n; i++) {
            const p = prev[i] as number
            if (p !== 0) for (let j = 0; j < m; j++) gw[i * m + j] = (gw[i * m + j] as number) + p * (delta[j] as number)
          }
          for (let j = 0; j < m; j++) gbl[j] = (gbl[j] as number) + (delta[j] as number)
          if (l > 0) {
            const nd = new Float64Array(n)
            for (let i = 0; i < n; i++) {
              let sum = 0
              for (let j = 0; j < m; j++) sum += (w[i * m + j] as number) * (delta[j] as number)
              const a = prev[i] as number
              nd[i] = net.activation === "relu" ? (a > 0 ? sum : 0) : sum * (1 - a * a) // relu' or tanh'
            }
            delta = nd
          }
        }
      }
      t++
      const c1 = 1 - b1 ** t, c2 = 1 - b2 ** t
      for (let l = 0; l < L; l++) {
        adam(net.W[l] as Float64Array, gW[l] as Float64Array, mW[l] as Float64Array, vW[l] as Float64Array)
        adam(net.b[l] as Float64Array, gb[l] as Float64Array, mb[l] as Float64Array, vb[l] as Float64Array)
      }
      function adam(P: Float64Array, G: Float64Array, M: Float64Array, V: Float64Array): void {
        for (let i = 0; i < P.length; i++) {
          const g = G[i] as number
          const mi = b1 * (M[i] as number) + (1 - b1) * g
          const vi = b2 * (V[i] as number) + (1 - b2) * g * g
          M[i] = mi
          V[i] = vi
          P[i] = (P[i] as number) - (rate * (mi / c1)) / (Math.sqrt(vi / c2) + eps)
        }
      }
    }
    curve.push(lossSum / (idx.length * outputs))
  }
  return curve
}
