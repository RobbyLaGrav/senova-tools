// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
import assert from "node:assert/strict"
import { test } from "node:test"

import { createRng } from "../src/index.ts"
import { applyLinear, leastSquares, mlp, percentile, predict, rms, round, scaler, train } from "../src/ml.ts"

// A small regression problem drawn the same way as when the reference numbers below were recorded with the original
// research code (y = sin(a) + b^2).
function data() {
  const g = createRng(3)
  const X: number[][] = []
  const Y: number[][] = []
  for (let i = 0; i < 64; i++) {
    const a = g.uniform(-1, 1), b = g.uniform(-1, 1)
    X.push([a, b])
    Y.push([Math.sin(a) + b * b])
  }
  return { X, Y }
}

test("train and predict reproduce the original research code bit for bit (tanh)", () => {
  const { X, Y } = data()
  const net = mlp([2, 8, 1], { seed: 5 })
  const curve = train(net, X, Y, { epochs: 5, batch: 8, seed: 9 })
  assert.deepEqual(curve, [1.058113601223198, 0.9603785152792179, 0.8918259924728041, 0.8264277742623609, 0.7765742803520521])
  assert.equal(predict(net, [0.3, -0.2])[0], -0.09759147757382436)
})

test("train reproduces the original research code bit for bit (relu)", () => {
  const { X, Y } = data()
  const net = mlp([2, 6, 1], { seed: 5, activation: "relu" })
  assert.deepEqual(train(net, X, Y, { epochs: 3, batch: 16, seed: 2 }), [0.716188764197251, 0.6865848384444793, 0.6572502081552843])
})

test("training lowers the loss on a learnable problem", () => {
  const { X, Y } = data()
  const curve = train(mlp([2, 16, 1], { seed: 1 }), X, Y, { epochs: 40, batch: 8 })
  assert.ok((curve.at(-1) as number) < (curve[0] as number) / 4, `loss ${curve[0]} -> ${curve.at(-1)}`)
})

test("leastSquares matches the original and recovers a known linear map", () => {
  const { X, Y } = data()
  const B = leastSquares(X.map((r) => [...r, 1]), Y)
  assert.deepEqual(B.map((r) => Array.from(r)), [[1.0382762288627314], [-0.0969731794650581], [0.31153931037391835]])
  // y = 2x0 - 3x1 + 0.5 exactly: the fit recovers it.
  const g = createRng(1)
  const Xs = Array.from({ length: 30 }, () => [g.normal(), g.normal(), 1])
  const Ys = Xs.map(([a, b]) => [2 * (a as number) - 3 * (b as number) + 0.5])
  const fit = leastSquares(Xs, Ys, 0)
  assert.deepEqual(applyLinear(fit, [1, 1, 1]).map((v) => round(v, 9)), [-0.5])
})

test("scaler standardises and inverts; a constant column maps to 0", () => {
  const s = scaler([[1, 5], [3, 5]])
  assert.deepEqual(s.apply([3, 5]), [1, 0])
  assert.deepEqual(s.invert([1, 0]), [3, 5])
})

test("stats helpers", () => {
  assert.equal(rms([3, 4]), Math.sqrt(12.5))
  assert.equal(percentile([5, 1, 3], 50), 3)
  assert.equal(percentile([5, 1, 3], 100), 5)
  assert.equal(round(1.23456, 2), 1.23)
  assert.throws(() => rms([]), RangeError)
  assert.throws(() => percentile([1], 101), RangeError)
})

test("shape mistakes are refused with a clear message", () => {
  assert.throws(() => mlp([2]), RangeError)
  const net = mlp([2, 3, 1])
  assert.throws(() => predict(net, [1, 2, 3]), /expects 2/)
  assert.throws(() => train(net, [[1, 2]], [[1, 2]]), /target rows need 1/)
  assert.throws(() => leastSquares([[1, 1], [1, 1]], [[1], [2]], 0), /singular/)
})
