// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// The results file: what a run produced, in a shape that can be saved, compared with the base branch and charted.
// parseRun checks a file read back from disk, since baselines and history come from earlier CI jobs.
import { BenchError } from "./errors.ts"

export type TestStatus = "pass" | "fail" | "error" | "timeout" | "skip"

export const STATUSES: readonly TestStatus[] = ["pass", "fail", "error", "timeout", "skip"]

export interface Measurement {
  name: string
  value: number
  unit?: string
  min?: number
  max?: number
  /** Finite and inside [min, max]. */
  ok: boolean
}

export interface TestResult {
  name: string
  status: TestStatus
  durationMs: number
  message?: string
  measurements: Measurement[]
  notes: string[]
  /** The last console lines, kept for tests that did not pass. */
  consoleTail: string[]
}

export interface RunMeta {
  commit?: string
  branch?: string
  [key: string]: string | undefined
}

export interface BenchRun {
  version: 1
  board: string
  image?: string
  meta: RunMeta
  /** ISO 8601. */
  startedAt: string
  durationMs: number
  passed: boolean
  tests: TestResult[]
}

/** A run passes when no test failed, errored or timed out. */
export function runPassed(tests: readonly TestResult[]): boolean {
  return tests.every((t) => t.status === "pass" || t.status === "skip")
}

const bad = (where: string, what: string) => new BenchError("BAD_RESULTS", `${where}: ${what}`)
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string")

function optionalNumber(o: Record<string, unknown>, key: string, where: string): number | undefined {
  const v = o[key]
  if (v === undefined || v === null) return undefined
  if (typeof v !== "number") throw bad(where, `${key} must be a number`)
  return v
}

function parseMeasurement(v: unknown, where: string): Measurement {
  if (!isObject(v)) throw bad(where, "must be an object")
  if (typeof v.name !== "string" || v.name.length === 0) throw bad(where, "name must be a non-empty string")
  // JSON has no NaN or Infinity; a non-finite reading is saved as null.
  const value = v.value === null ? Number.NaN : v.value
  if (typeof value !== "number") throw bad(where, "value must be a number or null")
  if (typeof v.ok !== "boolean") throw bad(where, "ok must be true or false")
  if (v.unit !== undefined && typeof v.unit !== "string") throw bad(where, "unit must be a string")
  const m: Measurement = { name: v.name, value, ok: v.ok }
  if (typeof v.unit === "string") m.unit = v.unit
  const min = optionalNumber(v, "min", where)
  const max = optionalNumber(v, "max", where)
  if (min !== undefined) m.min = min
  if (max !== undefined) m.max = max
  return m
}

function parseTest(v: unknown, where: string): TestResult {
  if (!isObject(v)) throw bad(where, "must be an object")
  if (typeof v.name !== "string" || v.name.length === 0) throw bad(where, "name must be a non-empty string")
  if (!STATUSES.includes(v.status as TestStatus)) throw bad(where, `status must be one of ${STATUSES.join(", ")}`)
  if (typeof v.durationMs !== "number" || !(v.durationMs >= 0)) throw bad(where, "durationMs must be a non-negative number")
  if (v.message !== undefined && typeof v.message !== "string") throw bad(where, "message must be a string")
  if (!Array.isArray(v.measurements)) throw bad(where, "measurements must be an array")
  if (!isStringArray(v.notes)) throw bad(where, "notes must be an array of strings")
  if (!isStringArray(v.consoleTail)) throw bad(where, "consoleTail must be an array of strings")
  const t: TestResult = {
    name: v.name,
    status: v.status as TestStatus,
    durationMs: v.durationMs,
    measurements: v.measurements.map((m, i) => parseMeasurement(m, `${where}.measurements[${i}]`)),
    notes: v.notes,
    consoleTail: v.consoleTail,
  }
  if (typeof v.message === "string") t.message = v.message
  return t
}

/** Validates a results file (a JSON string or an already parsed value). Throws `BAD_RESULTS` naming the bad field. */
export function parseRun(input: unknown): BenchRun {
  let v = input
  if (typeof input === "string") {
    try {
      v = JSON.parse(input)
    } catch (err) {
      throw new BenchError("BAD_RESULTS", `results are not valid JSON: ${(err as Error).message}`)
    }
  }
  if (!isObject(v)) throw bad("run", "must be an object")
  if (v.version !== 1) throw bad("run", `version ${JSON.stringify(v.version)} is not supported (expected 1)`)
  if (typeof v.board !== "string" || v.board.length === 0) throw bad("run", "board must be a non-empty string")
  if (v.image !== undefined && typeof v.image !== "string") throw bad("run", "image must be a string")
  if (!isObject(v.meta) || !Object.values(v.meta).every((s) => typeof s === "string")) throw bad("run", "meta must be an object of strings")
  if (typeof v.startedAt !== "string" || Number.isNaN(Date.parse(v.startedAt))) throw bad("run", "startedAt must be an ISO date")
  if (typeof v.durationMs !== "number" || !(v.durationMs >= 0)) throw bad("run", "durationMs must be a non-negative number")
  if (typeof v.passed !== "boolean") throw bad("run", "passed must be true or false")
  if (!Array.isArray(v.tests)) throw bad("run", "tests must be an array")
  const tests = v.tests.map((t, i) => parseTest(t, `tests[${i}]`))
  const run: BenchRun = {
    version: 1,
    board: v.board,
    meta: { ...(v.meta as Record<string, string>) },
    startedAt: v.startedAt,
    durationMs: v.durationMs,
    passed: v.passed,
    tests,
  }
  if (typeof v.image === "string") run.image = v.image
  return run
}

/** JSON for a results file. Non-finite readings become null, which parseRun reads back as NaN. */
export function stringifyRun(run: BenchRun): string {
  return JSON.stringify(run, (_k, value: unknown) => (typeof value === "number" && !Number.isFinite(value) ? null : value), 2) + "\n"
}
