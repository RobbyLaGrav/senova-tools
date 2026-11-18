// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
import { assertSeed, deriveSeed, type Rng } from "./random.ts"

/** What a part's `run` function receives. */
export interface PartContext {
  /** The experiment's name. */
  readonly experiment: string
  /** This part's name. */
  readonly part: string
  /** This part's seed: its own `seed` if set, otherwise derived from the experiment seed and the part name. */
  readonly seed: number
  /** A generator started from `seed`. Use it (or `rng.fork(label)`) for every random draw. */
  readonly rng: Rng
  /** Writes a progress line to stderr, prefixed with the part name. Logs never go into the results. */
  log(message: string): void
}

/** A part's work. It returns plain JSON data (objects, arrays, strings, finite numbers, booleans, null). */
export type PartFn = (ctx: PartContext) => unknown

/** A part, as written in a config file: a function, or an object with a function and options. */
export type PartSpec =
  | PartFn
  | {
      run: PartFn
      /** A fixed seed for this part, instead of the derived one. */
      seed?: number
      /** One line, shown by `seedrun list`. */
      description?: string
    }

/** Shown to a `merge` function. */
export interface MergeInfo {
  readonly experiment: string
  readonly seed: number
  /** Part names in the order the config declares them. */
  readonly parts: readonly string[]
}

/** An experiment, as written in a config file. */
export interface ExperimentConfig {
  /** A short name; written into every output file. */
  name: string
  /** The base seed, an integer from 0 to 2^32 - 1. */
  seed: number
  /** Bump this when the code changes the results, so old partial files are refused at merge. */
  version?: string
  /** The parts, by name (letters, digits, `-` and `_`). Each runs on its own and writes its own partial file. */
  parts: Record<string, PartSpec>
  /** Shapes the merged results from every part's result (keyed by part name). Defaults to that map as it is. */
  merge?: (results: Readonly<Record<string, unknown>>, info: MergeInfo) => unknown
  /** Where partial files go, relative to the config file. Default `out`. */
  outDir?: string
  /** The merged results file, relative to the config file. Default `results.json`. */
  resultsFile?: string
  /** Allow `Math.random()` inside parts. Off by default: unseeded draws are the usual way runs stop matching. */
  allowMathRandom?: boolean
}

/** A part after validation. */
export interface Part {
  readonly name: string
  readonly seed: number
  readonly description: string | undefined
  readonly run: PartFn
}

/** A validated experiment, ready to run. */
export interface Experiment {
  readonly name: string
  readonly seed: number
  readonly version: string | undefined
  readonly parts: readonly Part[]
  readonly merge: ExperimentConfig["merge"] | undefined
  readonly outDir: string
  readonly resultsFile: string
  readonly allowMathRandom: boolean
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

/**
 * Validates a config and fills in defaults. Use it as the default export of a config file so the editor checks it:
 * `export default defineExperiment({ ... })`.
 */
export function defineExperiment(config: ExperimentConfig): Experiment {
  if (typeof config !== "object" || config === null) throw new TypeError("defineExperiment() needs a config object")
  if (typeof config.name !== "string" || config.name.trim() === "") throw new TypeError("experiment name must be a non-empty string")
  assertSeed(config.seed, "experiment seed")
  if (config.version !== undefined && typeof config.version !== "string") throw new TypeError("version must be a string")
  if (typeof config.parts !== "object" || config.parts === null) throw new TypeError("parts must be an object of named parts")
  const names = Object.keys(config.parts)
  if (names.length === 0) throw new TypeError("an experiment needs at least one part")
  const parts = names.map((name): Part => {
    // Part names become file names, so they are kept to a safe alphabet (no paths, no dots).
    if (!NAME.test(name)) throw new TypeError(`part name "${name}" must be 1-64 letters, digits, "-" or "_", starting with a letter or digit`)
    if (name.toLowerCase() === "all") throw new TypeError(`"all" is reserved for running every part`)
    const spec = config.parts[name]
    if (typeof spec === "function") return { name, seed: deriveSeed(config.seed, name), description: undefined, run: spec }
    if (typeof spec !== "object" || spec === null || typeof spec.run !== "function") {
      throw new TypeError(`part "${name}" must be a function or { run(ctx) { ... } }`)
    }
    if (spec.seed !== undefined) assertSeed(spec.seed, `part "${name}" seed`)
    return { name, seed: spec.seed ?? deriveSeed(config.seed, name), description: spec.description, run: spec.run }
  })
  const lower = new Set(names.map((n) => n.toLowerCase()))
  if (lower.size !== names.length) throw new TypeError("part names must differ in more than letter case (they become file names)")
  if (config.merge !== undefined && typeof config.merge !== "function") throw new TypeError("merge must be a function")
  return Object.freeze({
    name: config.name,
    seed: config.seed,
    version: config.version,
    parts: Object.freeze(parts),
    merge: config.merge,
    outDir: config.outDir ?? "out",
    resultsFile: config.resultsFile ?? "results.json",
    allowMathRandom: config.allowMathRandom ?? false,
  })
}

/** Finds a part by name, or throws listing the names that exist. */
export function getPart(experiment: Experiment, name: string): Part {
  const part = experiment.parts.find((p) => p.name === name)
  if (!part) throw new Error(`no part "${name}" in experiment "${experiment.name}"; parts: ${experiment.parts.map((p) => p.name).join(", ")}`)
  return part
}

/** True for a value made by `defineExperiment`. */
export function isExperiment(value: unknown): value is Experiment {
  if (typeof value !== "object" || value === null) return false
  const v = value as Partial<Experiment>
  return typeof v.name === "string" && typeof v.seed === "number" && Array.isArray(v.parts) && typeof v.outDir === "string"
}
