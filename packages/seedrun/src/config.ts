// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { isExperiment, type Experiment } from "./experiment.ts"

/** File names `seedrun` looks for in the working directory, in this order. */
export const CONFIG_NAMES = ["seedrun.config.ts", "seedrun.config.mts", "seedrun.config.mjs", "seedrun.config.js"] as const

/** A config file, loaded. */
export interface LoadedConfig {
  readonly experiment: Experiment
  /** Absolute path of the config file. */
  readonly file: string
  /** Partial files directory, resolved against the config file's folder. */
  readonly outDir: string
  /** Merged results file, resolved against the config file's folder. */
  readonly resultsFile: string
}

/** Finds the config in `cwd` by the names in `CONFIG_NAMES`. */
export function findConfig(cwd: string = process.cwd()): string {
  for (const name of CONFIG_NAMES) {
    const path = join(cwd, name)
    if (existsSync(path)) return path
  }
  throw new Error(`no config found in ${cwd}; create seedrun.config.ts or pass --config <file>`)
}

/**
 * Imports a config file (TypeScript works directly on Node 24) and checks that its default export came from
 * `defineExperiment`. The file is code and runs with your permissions: only load configs you trust.
 */
export async function loadConfig(file: string): Promise<LoadedConfig> {
  const path = resolve(file)
  if (!existsSync(path)) throw new Error(`config file not found: ${path}`)
  const mod = (await import(pathToFileURL(path).href)) as { default?: unknown }
  if (!isExperiment(mod.default)) {
    throw new Error(`${path} must have a default export made by defineExperiment(): export default defineExperiment({ ... })`)
  }
  const experiment = mod.default
  const base = dirname(path)
  return { experiment, file: path, outDir: resolve(base, experiment.outDir), resultsFile: resolve(base, experiment.resultsFile) }
}
