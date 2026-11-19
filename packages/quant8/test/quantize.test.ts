// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
import assert from "node:assert/strict"
import { test } from "node:test"

import {
  accuracyReport,
  dequantizeValue,
  parseModel,
  parseSamples,
  predictQuantized,
  Quant8Error,
  quantize,
  quantizeInput,
  runFloat,
  runInt8,
} from "../src/index.ts"
import { randomInputs, randomModelJson } from "./helpers.ts"

// A tiny network written out by hand: 2 inputs -> 3 relu -> 2.
const TINY = {
  layers: [
    { weights: [[1, -1], [0.5, 0.25], [-0.75, 1]], bias: [0.1, 0, -0.2], activation: "relu" },
    { weights: [[1, 0.5, -1], [-0.5, 1, 0.25]], bias: [0, 0.05], activation: "none" },
  ],
}

test("tiny hand-written network: int8 tracks float within a few output steps", () => {
  const model = parseModel(TINY)
  assert.equal(model.inputSize, 2)
  const calib = randomInputs(64, 2, 1)
  for (const scheme of ["asymmetric", "symmetric"] as const) {
    const q = quantize(model, calib, { scheme })
    // Test inputs stay inside the calibrated range; outside it the int8 model saturates (tested below).
    for (const x of randomInputs(200, 2, 2, -0.8, 0.8)) {
      const f = runFloat(model, x)
      const g = predictQuantized(q, x)
      f.forEach((v, i) => assert.ok(Math.abs(v - g[i]!) <= 4 * q.output.scale, `${scheme} ${x} -> ${v} vs ${g[i]}`))
    }
  }
})

test("weights are symmetric per output channel, bias is int32 at input_scale * weight_scale", () => {
  const model = parseModel(TINY)
  const q = quantize(model, randomInputs(32, 2, 3))
  const l0 = q.layers[0]!
  assert.deepEqual(Array.from(l0.weights), [127, -127, 127, 64, -95, 127])
  assert.deepEqual(l0.weightScales, [1 / 127, 0.5 / 127, 1 / 127])
  assert.equal(l0.bias[0], Math.round(0.1 / (l0.input.scale * l0.weightScales[0]!)))
  assert.equal(l0.output.zeroPoint, -128) // relu output: range [0, max]
  assert.equal(l0.actMin, -128)
  assert.equal(q.layers[1]!.input, l0.output) // each layer reads the previous layer's params
})

test("a wider random network keeps argmax agreement high", () => {
  const model = parseModel(randomModelJson([8, 24, 16, 5], 11, true))
  const calib = randomInputs(200, 8, 12)
  const q = quantize(model, calib)
  const r = accuracyReport(model, q, { inputs: randomInputs(300, 8, 13) })
  assert.equal(r.samples, 300)
  assert.ok(r.argmaxAgreement >= 0.95, `agreement ${r.argmaxAgreement}`)
  assert.ok(r.maxAbsError < 0.05, `max abs error ${r.maxAbsError}`)
})

test("dead relu layer (zero range) still quantises and outputs exact zeros", () => {
  const model = parseModel({
    layers: [
      { weights: [[-1, -1], [-2, 0]], bias: [-5, -5], activation: "relu" },
      { weights: [[1, 1]], bias: [0.5], activation: "none" },
    ],
  })
  const q = quantize(model, randomInputs(20, 2, 4))
  assert.equal(q.layers[0]!.output.scale, 1)
  const out = predictQuantized(q, [0.3, -0.2])
  assert.ok(Math.abs(out[0]! - 0.5) <= q.output.scale)
})

test("all-zero weight channel and a constant output", () => {
  const model = parseModel({ layers: [{ weights: [[0, 0], [1, 2]], bias: [0, 0], activation: "none" }] })
  const q = quantize(model, [[1, 1], [-1, 0.5]])
  assert.deepEqual(Array.from(q.layers[0]!.weights.subarray(0, 2)), [0, 0])
  const y = runInt8(q, quantizeInput(q, [0.7, -0.4]))
  assert.equal(dequantizeValue(y[0]!, q.output), 0)
})

test("inputs outside the calibration range saturate instead of wrapping", () => {
  const model = parseModel(TINY)
  const q = quantize(model, randomInputs(16, 2, 5, -0.1, 0.1))
  assert.deepEqual(Array.from(quantizeInput(q, [1000, -1000])), [127, -128])
  const out = runInt8(q, [127, -128])
  for (const v of out) assert.ok(v >= -128 && v <= 127)
})

test("labels give float and int8 accuracy", () => {
  const model = parseModel(TINY)
  const inputs = [[1, 0], [0, 1], [0.5, -0.5]]
  const labels = inputs.map((x) => (runFloat(model, x)[0]! > runFloat(model, x)[1]! ? 0 : 1))
  const r = accuracyReport(model, quantize(model, inputs), parseSamples({ inputs, labels }, 2))
  assert.equal(r.floatAccuracy, 1)
  assert.ok(r.int8Accuracy! >= 2 / 3)
})

test("bad models fail with the path of the problem", () => {
  const bad: [unknown, RegExp][] = [
    [null, /JSON object/],
    [{ layers: [] }, /non-empty/],
    [{ layers: [{ weights: [[1, 2]], bias: [0, 0] }] }, /bias has 2 values, expected 1/],
    [{ layers: [{ weights: [[1, 2]] }, { weights: [[1, 2]] }] }, /layers\[1\]\.weights\[0\] has 2 values, expected 1/],
    [{ layers: [{ weights: [[1, Number.NaN]] }] }, /weights\[0\]\[1\] is null/],
    [{ layers: [{ weights: [[1, "2"]] }] }, /expected a finite number/],
    [{ layers: [{ weights: [[1]], activation: "tanh" }] }, /use "relu" or "none"/],
    [{ layers: [{ weights: [[1]], activation: "softmax" }] }, /"softmax": true on the model/],
    [{ layers: [{ type: "conv2d", weights: [[1]] }] }, /only "dense"/],
    [{ inputSize: 3, layers: [{ weights: [[1, 2]] }] }, /has 2 values, expected 3/],
    [{ inputSize: 0, layers: [{ weights: [[1]] }] }, /positive integer/],
    [{ softmax: "yes", layers: [{ weights: [[1]] }] }, /true or false/],
  ]
  for (const [json, re] of bad) {
    // JSON.parse turns NaN into null; mimic that so the message is what a file would give.
    const parsed = JSON.parse(JSON.stringify(json))
    assert.throws(() => parseModel(parsed), (e: unknown) => e instanceof Quant8Error && re.test(e.message), JSON.stringify(json))
  }
})

test("bad samples and calibration fail clearly", () => {
  assert.throws(() => parseSamples([], 2), /non-empty/)
  assert.throws(() => parseSamples([[1]], 2), /inputs\[0\] has 1 values, expected 2/)
  assert.throws(() => parseSamples({ inputs: [[1, 2]], labels: [0.5] }, 2), /non-negative integer/)
  assert.throws(() => parseSamples({ inputs: [[1, 2]], labels: [0, 1] }, 2), /has 2 values, expected 1/)
  assert.throws(() => parseSamples("x", 2), /array of input vectors/)
  const model = parseModel(TINY)
  assert.throws(() => quantize(model, []), /at least one input sample/)
  assert.throws(() => quantize(model, [[1, 2]], { scheme: "per-channel" as never }), /scheme must be/)
})

test("an int32 bias overflow is reported, not wrapped", () => {
  const model = parseModel({ layers: [{ weights: [[1e-6, 1e-6]], bias: [1e6], activation: "none" }] })
  assert.throws(() => quantize(model, [[0.001, 0.001]]), /too large for the int32 accumulator/)
})

test("runInt8 rejects values that are not int8", () => {
  const q = quantize(parseModel(TINY), [[0, 0], [1, 1]])
  assert.throws(() => runInt8(q, [200, 0]), /int8 value/)
  assert.throws(() => runInt8(q, [1.5, 0]), /int8 value/)
  assert.throws(() => runInt8(q, [1]), /expected 2/)
})
