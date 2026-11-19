// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Post-training int8 quantisation and the int8 reference interpreter.
//
// Weights: symmetric, per output channel, int8 in [-127, 127], zero point 0.
// Activations: per tensor, asymmetric (zero point in [-128, 127]) or symmetric (zero point 0), ranges from calibration.
// Bias: int32 with scale input_scale * weight_scale[c] and zero point 0.
// Each output: acc = bias + sum(w * (x - x_zp)); y = clamp(requantize(acc) + y_zp, act_min, 127).
import {
  clamp,
  INT32_MAX,
  quantizeMultiplier,
  requantize,
  roundHalfAway,
} from "./fixedpoint.ts"
import { argmax, forwardLayers, Quant8Error, softmax, type Activation, type FloatModel } from "./model.ts"

export type Scheme = "asymmetric" | "symmetric"

/** Scale and zero point of an int8 tensor: real = scale * (q - zeroPoint). */
export interface QParams {
  scale: number
  zeroPoint: number
}

/** One quantised dense layer. Flat weights are row-major: weights[o * inputs + i]. */
export interface QuantLayer {
  inputs: number
  outputs: number
  activation: Activation
  weights: Int8Array
  weightScales: number[]
  bias: Int32Array
  multipliers: Int32Array
  shifts: Int8Array
  input: QParams
  output: QParams
  /** Lowest int8 output: the zero point after relu (real 0), else -128. */
  actMin: number
}

export interface QuantModel {
  scheme: Scheme
  inputSize: number
  input: QParams
  layers: QuantLayer[]
  output: QParams
  softmax: boolean
}

export interface QuantizeOptions {
  /** Activation quantisation. Asymmetric (default) uses the full int8 range for one-sided ranges such as relu outputs. */
  scheme?: Scheme
}

/** Picks scale and zero point for a real range. The range always includes 0 so that real 0 is exact. */
export function chooseQParams(min: number, max: number, scheme: Scheme): QParams {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) throw new Quant8Error(`invalid range [${min}, ${max}]`)
  const lo = Math.min(min, 0)
  const hi = Math.max(max, 0)
  if (scheme === "symmetric") {
    const a = Math.max(-lo, hi)
    return { scale: a > 0 ? a / 127 : 1, zeroPoint: 0 }
  }
  // A zero-width range (the tensor is always 0) gets scale 1: any scale represents 0 exactly.
  const scale = hi > lo ? (hi - lo) / 255 : 1
  return { scale, zeroPoint: clamp(roundHalfAway(-128 - lo / scale), -128, 127) }
}

/** real -> int8 with the given params (round half away from zero, saturating). */
export const quantizeValue = (x: number, p: QParams): number => clamp(roundHalfAway(x / p.scale) + p.zeroPoint, -128, 127)

/** int8 -> real. */
export const dequantizeValue = (q: number, p: QParams): number => p.scale * (q - p.zeroPoint)

/**
 * Quantises a float model to int8 using calibration inputs to fix every activation range.
 * Throws Quant8Error when a value cannot be represented (an int32 bias overflow, or an accumulator that could overflow).
 */
export function quantize(model: FloatModel, calibration: readonly (readonly number[])[], options: QuantizeOptions = {}): QuantModel {
  const scheme = options.scheme ?? "asymmetric"
  if (scheme !== "asymmetric" && scheme !== "symmetric") throw new Quant8Error(`scheme must be "asymmetric" or "symmetric", got ${JSON.stringify(scheme)}`)
  if (calibration.length === 0) throw new Quant8Error("calibration needs at least one input sample")

  // Ranges: index 0 is the model input, index l + 1 is layer l's output (after its activation).
  const mins = new Array<number>(model.layers.length + 1).fill(Infinity)
  const maxs = new Array<number>(model.layers.length + 1).fill(-Infinity)
  const see = (k: number, v: readonly number[]) => {
    for (const x of v) {
      if (x < mins[k]!) mins[k] = x
      if (x > maxs[k]!) maxs[k] = x
    }
  }
  for (const sample of calibration) {
    see(0, sample)
    forwardLayers(model, sample).forEach((out, l) => see(l + 1, out))
  }
  for (let k = 0; k < mins.length; k++) {
    if (!Number.isFinite(mins[k]!) || !Number.isFinite(maxs[k]!)) {
      throw new Quant8Error(`${k === 0 ? "calibration input" : `layer ${k - 1} output`} is not finite; check the model weights and samples`)
    }
  }
  const params = mins.map((lo, k) => chooseQParams(lo, maxs[k]!, scheme))

  const layers = model.layers.map((layer, l): QuantLayer => {
    const input = params[l]!
    const output = params[l + 1]!
    const outputs = layer.weights.length
    const inputs = layer.weights[0]!.length
    const weights = new Int8Array(outputs * inputs)
    const weightScales: number[] = []
    const bias = new Int32Array(outputs)
    const multipliers = new Int32Array(outputs)
    const shifts = new Int8Array(outputs)
    for (let o = 0; o < outputs; o++) {
      const row = layer.weights[o]!
      const maxAbs = row.reduce((m, w) => Math.max(m, Math.abs(w)), 0)
      // An all-zero channel gets scale 1; its weights are 0 whatever the scale.
      const ws = maxAbs > 0 ? maxAbs / 127 : 1
      weightScales.push(ws)
      let absSum = 0
      for (let i = 0; i < inputs; i++) {
        const q = clamp(roundHalfAway(row[i]! / ws), -127, 127)
        weights[o * inputs + i] = q
        absSum += Math.abs(q)
      }
      const qb = roundHalfAway(layer.bias[o]! / (input.scale * ws))
      // |x - x_zp| <= 255, so this bounds the int32 accumulator for any input.
      if (Math.abs(qb) + absSum * 255 > INT32_MAX) {
        throw new Quant8Error(
          `layer ${l} output ${o}: bias ${layer.bias[o]} is too large for the int32 accumulator at input scale ${input.scale}; ` +
            "rescale the inputs or the layer",
        )
      }
      bias[o] = qb
      let qm
      try {
        qm = quantizeMultiplier((input.scale * ws) / output.scale)
      } catch (err) {
        throw new Quant8Error(`layer ${l} output ${o}: ${(err as Error).message}`)
      }
      multipliers[o] = qm.multiplier
      shifts[o] = qm.shift
    }
    const actMin = layer.activation === "relu" ? Math.max(-128, output.zeroPoint) : -128
    return { inputs, outputs, activation: layer.activation, weights, weightScales, bias, multipliers, shifts, input, output, actMin }
  })
  return { scheme, inputSize: model.inputSize, input: params[0]!, layers, output: params.at(-1)!, softmax: model.softmax }
}

/** Quantises a real input vector with the model's input params. */
export function quantizeInput(qmodel: QuantModel, x: readonly number[]): Int8Array {
  if (x.length !== qmodel.inputSize) throw new Quant8Error(`input has ${x.length} values, expected ${qmodel.inputSize}`)
  return Int8Array.from(x, (v) => quantizeValue(v, qmodel.input))
}

/** One dense layer in integers, exactly as the generated C computes it. */
export function runQuantLayer(layer: QuantLayer, input: ArrayLike<number>): Int8Array {
  const out = new Int8Array(layer.outputs)
  const zx = layer.input.zeroPoint
  for (let o = 0; o < layer.outputs; o++) {
    let acc = layer.bias[o]!
    const base = o * layer.inputs
    for (let i = 0; i < layer.inputs; i++) acc += layer.weights[base + i]! * (input[i]! - zx)
    out[o] = requantize(acc, layer.multipliers[o]!, layer.shifts[o]!, layer.output.zeroPoint, layer.actMin)
  }
  return out
}

/** The int8 reference interpreter: int8 input -> int8 output, bit-exact with `<name>_predict` in the generated C. */
export function runInt8(qmodel: QuantModel, input: ArrayLike<number>): Int8Array {
  if (input.length !== qmodel.inputSize) throw new Quant8Error(`input has ${input.length} values, expected ${qmodel.inputSize}`)
  for (let i = 0; i < input.length; i++) {
    const v = input[i]!
    if (!Number.isInteger(v) || v < -128 || v > 127) throw new Quant8Error(`input[${i}] is ${v}, expected an int8 value in [-128, 127]`)
  }
  let x: ArrayLike<number> = input
  for (const layer of qmodel.layers) x = runQuantLayer(layer, x)
  return x as Int8Array
}

/** int8 output -> real values, with softmax applied if the model has it. */
export function dequantizeOutput(qmodel: QuantModel, q: ArrayLike<number>): number[] {
  const y = Array.from(q, (v) => dequantizeValue(v, qmodel.output))
  return qmodel.softmax ? softmax(y) : y
}

/** Real input -> quantise -> int8 network -> dequantise (and softmax). Comparable with runFloat. */
export function predictQuantized(qmodel: QuantModel, x: readonly number[]): number[] {
  return dequantizeOutput(qmodel, runInt8(qmodel, quantizeInput(qmodel, x)))
}

/** Class index from int8 outputs. Softmax does not change the order, so this works without it. */
export const argmaxInt8 = (q: ArrayLike<number>): number => argmax(Array.from(q))
