// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// The float model: its JSON format, validation and a plain forward pass.

export type Activation = "relu" | "none"

/** One fully connected layer. `weights[o][i]` connects input i to output o. */
export interface DenseLayer {
  weights: number[][]
  bias: number[]
  activation: Activation
}

/** A small feed-forward network: dense layers, then an optional softmax. */
export interface FloatModel {
  inputSize: number
  layers: DenseLayer[]
  softmax: boolean
}

/** Calibration or test samples, with optional class labels for an accuracy figure. */
export interface Samples {
  inputs: number[][]
  labels?: number[]
}

/** Largest layer width accepted. Microcontroller models are far smaller; this stops runaway files. */
export const MAX_WIDTH = 65536
/** Largest total weight count accepted (about 4 MB of int8 flash). */
export const MAX_PARAMS = 4_000_000

/** Thrown for input that does not describe a usable model or sample set. */
export class Quant8Error extends Error {
  override name = "Quant8Error"
}

const fail = (msg: string): never => {
  throw new Quant8Error(msg)
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

function numberArray(v: unknown, where: string, length?: number): number[] {
  if (!Array.isArray(v)) fail(`${where} must be an array of numbers`)
  const arr = v as unknown[]
  if (length !== undefined && arr.length !== length) fail(`${where} has ${arr.length} values, expected ${length}`)
  arr.forEach((x, i) => {
    if (typeof x !== "number" || !Number.isFinite(x)) fail(`${where}[${i}] is ${JSON.stringify(x)}, expected a finite number`)
  })
  return arr as number[]
}

/** Checks a parsed JSON value and returns it as a FloatModel. Throws Quant8Error with the exact path of a problem. */
export function parseModel(json: unknown): FloatModel {
  if (!isObj(json)) return fail("model must be a JSON object with a \"layers\" array")
  const layersRaw = json.layers
  if (!Array.isArray(layersRaw) || layersRaw.length === 0) return fail("model.layers must be a non-empty array")
  if (json.softmax !== undefined && typeof json.softmax !== "boolean") fail("model.softmax must be true or false")
  let inputSize: number
  if (json.inputSize !== undefined) {
    if (!Number.isInteger(json.inputSize) || (json.inputSize as number) < 1) fail("model.inputSize must be a positive integer")
    inputSize = json.inputSize as number
  } else {
    const first = layersRaw[0] as { weights?: unknown[][] }
    inputSize = Array.isArray(first?.weights) && Array.isArray(first.weights[0]) ? first.weights[0].length : 0
    if (inputSize < 1) fail("model.layers[0].weights must be a non-empty matrix (rows = outputs, columns = inputs)")
  }
  if (inputSize > MAX_WIDTH) fail(`model.inputSize ${inputSize} is over the limit of ${MAX_WIDTH}`)
  let width = inputSize
  let params = 0
  const layers: DenseLayer[] = layersRaw.map((raw: unknown, li: number) => {
    const where = `model.layers[${li}]`
    if (!isObj(raw)) return fail(`${where} must be an object with weights, bias and activation`)
    if (raw.type !== undefined && raw.type !== "dense") fail(`${where}.type is ${JSON.stringify(raw.type)}; only "dense" layers are supported`)
    const act = raw.activation ?? "none"
    if (act !== "relu" && act !== "none") {
      fail(
        act === "softmax"
          ? `${where}.activation "softmax": put "softmax": true on the model instead (softmax is only allowed at the end)`
          : `${where}.activation is ${JSON.stringify(act)}; use "relu" or "none"`,
      )
    }
    if (!Array.isArray(raw.weights) || raw.weights.length === 0) fail(`${where}.weights must be a non-empty matrix`)
    const rows = raw.weights as unknown[]
    if (rows.length > MAX_WIDTH) fail(`${where} has ${rows.length} outputs, over the limit of ${MAX_WIDTH}`)
    const weights = rows.map((row, o) => numberArray(row, `${where}.weights[${o}]`, width))
    const bias = raw.bias === undefined ? new Array<number>(rows.length).fill(0) : numberArray(raw.bias, `${where}.bias`, rows.length)
    params += rows.length * width
    if (params > MAX_PARAMS) fail(`model has more than ${MAX_PARAMS} weights; quant8 is for microcontroller-sized networks`)
    width = rows.length
    return { weights, bias, activation: act as Activation }
  })
  return { inputSize, layers, softmax: json.softmax === true }
}

/** Checks samples: either `[[...], ...]` or `{ "inputs": [[...]], "labels": [0, 2, ...] }`. */
export function parseSamples(json: unknown, inputSize: number, what = "samples"): Samples {
  const obj = Array.isArray(json) ? { inputs: json } : json
  if (!isObj(obj)) return fail(`${what} must be an array of input vectors or an object with an "inputs" array`)
  if (!Array.isArray(obj.inputs) || obj.inputs.length === 0) return fail(`${what}.inputs must be a non-empty array of input vectors`)
  const inputs = (obj.inputs as unknown[]).map((row, i) => numberArray(row, `${what}.inputs[${i}]`, inputSize))
  if (obj.labels === undefined) return { inputs }
  const labels = numberArray(obj.labels, `${what}.labels`, inputs.length)
  labels.forEach((l, i) => {
    if (!Number.isInteger(l) || l < 0) fail(`${what}.labels[${i}] must be a non-negative integer class index`)
  })
  return { inputs, labels }
}

/** Number of outputs of the model. */
export const outputSize = (model: { layers: readonly { bias: readonly number[] }[] }): number => model.layers.at(-1)!.bias.length

/** Numerically stable softmax. */
export function softmax(x: readonly number[]): number[] {
  const m = Math.max(...x)
  const e = x.map((v) => Math.exp(v - m))
  const s = e.reduce((a, b) => a + b, 0)
  return e.map((v) => v / s)
}

/** Index of the largest value (first one on ties). */
export function argmax(x: readonly number[]): number {
  let best = 0
  for (let i = 1; i < x.length; i++) if (x[i]! > x[best]!) best = i
  return best
}

/**
 * Float forward pass. Returns the output of every layer after its activation (before softmax);
 * calibration uses these to choose each layer's int8 range.
 */
export function forwardLayers(model: FloatModel, input: readonly number[]): number[][] {
  if (input.length !== model.inputSize) throw new Quant8Error(`input has ${input.length} values, expected ${model.inputSize}`)
  const outs: number[][] = []
  let x: readonly number[] = input
  for (const layer of model.layers) {
    const y = layer.weights.map((row, o) => {
      let acc = layer.bias[o]!
      for (let i = 0; i < row.length; i++) acc += row[i]! * x[i]!
      return layer.activation === "relu" && acc < 0 ? 0 : acc
    })
    outs.push(y)
    x = y
  }
  return outs
}

/** Float model output (softmax applied if the model has it). */
export function runFloat(model: FloatModel, input: readonly number[]): number[] {
  const out = forwardLayers(model, input).at(-1)!
  return model.softmax ? softmax(out) : out
}
