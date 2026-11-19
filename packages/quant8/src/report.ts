// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Float vs int8 accuracy over a sample set.
import { argmax, Quant8Error, runFloat, type FloatModel, type Samples } from "./model.ts"
import { predictQuantized, type QuantModel } from "./quantize.ts"

export interface AccuracyReport {
  samples: number
  /** Largest |float - int8| over every output of every sample (after softmax if the model has it). */
  maxAbsError: number
  /** Mean |float - int8| over every output of every sample. */
  meanAbsError: number
  /** Samples where the float and int8 models pick the same output index. */
  argmaxMatches: number
  /** argmaxMatches / samples. */
  argmaxAgreement: number
  /** Only when labels were given: fraction of samples each model classifies correctly. */
  floatAccuracy?: number
  int8Accuracy?: number
}

/** Runs both models on every sample and compares them. */
export function accuracyReport(model: FloatModel, qmodel: QuantModel, samples: Samples): AccuracyReport {
  if (samples.inputs.length === 0) throw new Quant8Error("accuracy report needs at least one sample")
  let maxAbs = 0
  let sumAbs = 0
  let count = 0
  let matches = 0
  let floatRight = 0
  let int8Right = 0
  samples.inputs.forEach((x, s) => {
    const f = runFloat(model, x)
    const q = predictQuantized(qmodel, x)
    for (let i = 0; i < f.length; i++) {
      const e = Math.abs(f[i]! - q[i]!)
      if (e > maxAbs) maxAbs = e
      sumAbs += e
      count++
    }
    const fa = argmax(f)
    const qa = argmax(q)
    if (fa === qa) matches++
    const label = samples.labels?.[s]
    if (label !== undefined) {
      if (fa === label) floatRight++
      if (qa === label) int8Right++
    }
  })
  const n = samples.inputs.length
  const report: AccuracyReport = { samples: n, maxAbsError: maxAbs, meanAbsError: sumAbs / count, argmaxMatches: matches, argmaxAgreement: matches / n }
  if (samples.labels) {
    report.floatAccuracy = floatRight / n
    report.int8Accuracy = int8Right / n
  }
  return report
}
