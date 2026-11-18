// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

import { getPart, type Experiment } from "./experiment.ts"
import { sha256, stableStringify } from "./json.ts"
import { createRng } from "./random.ts"

/** Format version written into every file, so a future layout change can be detected. */
export const FORMAT = 1

/** The contents of a partial file (`<outDir>/<part>.json`). */
export interface PartialFile {
  seedrun: number
  experiment: string
  version?: string
  experimentSeed: number
  part: string
  seed: number
  result: unknown
}

/** The contents of the merged results file. */
export interface ResultsFile {
  seedrun: number
  experiment: string
  version?: string
  seed: number
  /** Each part's seed, so a single part can be re-run on its own. */
  parts: Record<string, number>
  results: unknown
}

/** One part's output, computed in memory. */
export interface PartOutput {
  readonly part: string
  readonly seed: number
  /** The canonical JSON of the partial file. Same seed and code, same bytes. */
  readonly json: string
  readonly sha256: string
  /** Wall-clock time. Reported only; never written into a file, since it differs on every run. */
  readonly seconds: number
}

/** A part's output after it was written to disk. */
export interface PartRun extends PartOutput {
  readonly file: string
}

/** The merged results. */
export interface MergeOutput {
  readonly json: string
  readonly sha256: string
  readonly results: ResultsFile
  /** Set when the results were written. */
  readonly file: string | undefined
}

export interface RunOptions {
  /** Directory for partial files. */
  outDir: string
  /** Where a part's `ctx.log` lines go. Default: stderr. */
  log?: (line: string) => void
}

export interface MergeOptions {
  /** Directory holding the partial files. */
  outDir: string
  /** Write the merged results here. Leave out to only compute them. */
  resultsFile?: string
}

/** Runs one part in memory and returns its canonical JSON, without writing anything. */
export async function computePart(experiment: Experiment, name: string, options: Pick<RunOptions, "log"> = {}): Promise<PartOutput> {
  const part = getPart(experiment, name)
  const write = options.log ?? ((line: string) => process.stderr.write(line + "\n"))
  const ctx = {
    experiment: experiment.name,
    part: part.name,
    seed: part.seed,
    rng: createRng(part.seed),
    log: (message: string) => write(`[${part.name}] ${message}`),
  }
  const t0 = performance.now()
  const result = await guardMathRandom(experiment, () => part.run(ctx))
  const seconds = (performance.now() - t0) / 1000
  if (result === undefined) throw new TypeError(`part "${part.name}" returned undefined; return the data to keep`)
  const file: PartialFile = {
    seedrun: FORMAT,
    experiment: experiment.name,
    ...(experiment.version !== undefined && { version: experiment.version }),
    experimentSeed: experiment.seed,
    part: part.name,
    seed: part.seed,
    result,
  }
  const json = stableStringify(file)
  return { part: part.name, seed: part.seed, json, sha256: sha256(json), seconds }
}

/** Runs one part and writes `<outDir>/<part>.json`. */
export async function runPart(experiment: Experiment, name: string, options: RunOptions): Promise<PartRun> {
  const out = await computePart(experiment, name, options)
  const file = partialPath(options.outDir, out.part)
  writeAtomic(file, out.json)
  return { ...out, file }
}

/**
 * Reads every part's partial file and combines them, in the order the config declares the parts. Refuses a missing
 * part, a file from another experiment, and a file made with a different seed or version (a stale run).
 */
export async function mergeParts(experiment: Experiment, options: MergeOptions): Promise<MergeOutput> {
  const byPart: Record<string, unknown> = {}
  const seeds: Record<string, number> = {}
  const missing: string[] = []
  for (const part of experiment.parts) {
    const path = partialPath(options.outDir, part.name)
    let text: string
    try {
      text = readFileSync(path, "utf8")
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        missing.push(part.name)
        continue
      }
      throw err
    }
    const partial = parsePartial(text, path)
    const stale = (what: string, got: unknown, want: unknown) =>
      new Error(`${path} was made with ${what} ${JSON.stringify(got)}, but the config now has ${JSON.stringify(want)}; re-run part "${part.name}"`)
    if (partial.experiment !== experiment.name) throw stale("experiment", partial.experiment, experiment.name)
    if (partial.part !== part.name) throw stale("part", partial.part, part.name)
    if (partial.experimentSeed !== experiment.seed) throw stale("experiment seed", partial.experimentSeed, experiment.seed)
    if (partial.seed !== part.seed) throw stale("part seed", partial.seed, part.seed)
    if (partial.version !== experiment.version) throw stale("version", partial.version ?? null, experiment.version ?? null)
    byPart[part.name] = partial.result
    seeds[part.name] = part.seed
  }
  if (missing.length > 0) {
    throw new Error(`missing results for ${missing.map((m) => `"${m}"`).join(", ")} in ${options.outDir}; run: seedrun run ${missing.join(" ")}`)
  }
  const info = { experiment: experiment.name, seed: experiment.seed, parts: experiment.parts.map((p) => p.name) }
  const merged = experiment.merge ? await experiment.merge(Object.freeze({ ...byPart }), info) : byPart
  if (merged === undefined) throw new TypeError("merge() returned undefined; return the combined results")
  const results: ResultsFile = {
    seedrun: FORMAT,
    experiment: experiment.name,
    ...(experiment.version !== undefined && { version: experiment.version }),
    seed: experiment.seed,
    parts: seeds,
    results: merged,
  }
  const json = stableStringify(results)
  if (options.resultsFile !== undefined) writeAtomic(options.resultsFile, json)
  return { json, sha256: sha256(json), results, file: options.resultsFile }
}

/** Path of a part's partial file. */
export function partialPath(outDir: string, part: string): string {
  return resolve(join(outDir, `${part}.json`))
}

function parsePartial(text: string, path: string): PartialFile {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`${path} is not valid JSON; delete it and re-run that part`)
  }
  const p = data as Partial<PartialFile> | null
  if (typeof p !== "object" || p === null || p.seedrun !== FORMAT || !("result" in p)) {
    throw new Error(`${path} is not a seedrun partial file (format ${FORMAT})`)
  }
  return p as PartialFile
}

/** Writes through a temporary file and a rename, so a crash never leaves a half-written file behind. */
function writeAtomic(path: string, text: string): void {
  mkdirSync(dirname(resolve(path)), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, text)
  renameSync(tmp, path)
}

// Math.random is swapped for a throwing stub while parts run, unless the config allows it. A counter keeps the stub in
// place while several parts run concurrently in one process.
let guards = 0
let original: (() => number) | undefined

async function guardMathRandom<T>(experiment: Experiment, fn: () => T): Promise<Awaited<T>> {
  if (experiment.allowMathRandom) return await fn()
  if (guards++ === 0) {
    original = Math.random
    Math.random = () => {
      throw new Error("Math.random() is not seeded, so runs would not repeat; use ctx.rng (or set allowMathRandom: true)")
    }
  }
  try {
    return await fn()
  } finally {
    if (--guards === 0 && original) Math.random = original
  }
}
