// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Seedrun: run reproducible experiments with fixed seeds, split into parts that run side by side, and merge them into
// one results file. The small neural network, optimiser and least-squares helpers are in "@senova/seedrun/ml".

export { createRng, deriveSeed, type Rng } from "./random.ts"
export {
  defineExperiment,
  type Experiment,
  type ExperimentConfig,
  type MergeInfo,
  type Part,
  type PartContext,
  type PartFn,
  type PartSpec,
} from "./experiment.ts"
export {
  computePart,
  mergeParts,
  partialPath,
  runPart,
  type MergeOptions,
  type MergeOutput,
  type PartialFile,
  type PartOutput,
  type PartRun,
  type ResultsFile,
  type RunOptions,
} from "./run.ts"
export { CONFIG_NAMES, findConfig, loadConfig, type LoadedConfig } from "./config.ts"
export { sha256, stableStringify } from "./json.ts"
export { mean, percentile, rms, round } from "./stats.ts"
