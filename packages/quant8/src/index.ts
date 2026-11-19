// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Public API. Quantise a small dense network to int8, check it against the float model, and generate C99 for a
// microcontroller that computes exactly what runInt8 computes.
import { generateC, memoryEstimate, type GeneratedC, type MemoryEstimate } from "./codegen.ts"
import { parseModel, parseSamples, type FloatModel, type Samples } from "./model.ts"
import { quantize, type QuantModel, type Scheme } from "./quantize.ts"
import { accuracyReport, type AccuracyReport } from "./report.ts"

export {
  argmax,
  forwardLayers,
  MAX_PARAMS,
  MAX_WIDTH,
  outputSize,
  parseModel,
  parseSamples,
  Quant8Error,
  runFloat,
  softmax,
  type Activation,
  type DenseLayer,
  type FloatModel,
  type Samples,
} from "./model.ts"
export {
  clamp,
  INT32_MAX,
  INT32_MIN,
  MAX_LEFT_SHIFT,
  multiplyByQuantizedMultiplier,
  quantizeMultiplier,
  requantize,
  roundHalfAway,
  roundingDivideByPOT,
  saturatingRoundingDoublingHighMul,
  type QuantizedMultiplier,
} from "./fixedpoint.ts"
export {
  argmaxInt8,
  chooseQParams,
  dequantizeOutput,
  dequantizeValue,
  predictQuantized,
  quantize,
  quantizeInput,
  quantizeValue,
  runInt8,
  runQuantLayer,
  type QParams,
  type QuantizeOptions,
  type QuantLayer,
  type QuantModel,
  type Scheme,
} from "./quantize.ts"
export { checkName, generateC, memoryEstimate, type GeneratedC, type GenerateOptions, type MemoryEstimate } from "./codegen.ts"
export { accuracyReport, type AccuracyReport } from "./report.ts"

export interface Quant8Options {
  /** C prefix and file name (default "model"). */
  name?: string
  /** Activation quantisation (default "asymmetric"). */
  scheme?: Scheme
  /** Test samples for the accuracy report, same format as the calibration samples. Defaults to the calibration set. */
  test?: unknown
}

export interface Quant8Result {
  model: FloatModel
  quantized: QuantModel
  c: GeneratedC
  memory: MemoryEstimate
  /** Over the test samples if given, else over the calibration samples. */
  accuracy: AccuracyReport
}

/**
 * The whole pipeline on parsed JSON: validate, quantise with the calibration samples, generate C and compare float
 * vs int8 on the test samples (or the calibration samples when no test set is given).
 */
export function quant8(modelJson: unknown, calibJson: unknown, options: Quant8Options = {}): Quant8Result {
  const model = parseModel(modelJson)
  const calib = parseSamples(calibJson, model.inputSize, "calibration")
  const test: Samples = options.test !== undefined ? parseSamples(options.test, model.inputSize, "test") : calib
  const quantized = quantize(model, calib.inputs, options.scheme !== undefined ? { scheme: options.scheme } : {})
  const c = generateC(quantized, options.name !== undefined ? { name: options.name } : {})
  return { model, quantized, c, memory: memoryEstimate(quantized), accuracy: accuracyReport(model, quantized, test) }
}
