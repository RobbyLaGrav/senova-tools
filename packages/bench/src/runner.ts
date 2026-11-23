// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Runs tests against one board, one at a time: flash (or reset) once, reset between tests, a timeout on each, and
// every measurement kept whether it passed or not.
import type { Board } from "./board.ts"
import { BenchError, invalid } from "./errors.ts"
import type { LinePattern } from "./lines.ts"
import { runPassed, type BenchRun, type Measurement, type RunMeta, type TestResult, type TestStatus } from "./results.ts"

export interface MeasureOptions {
  unit?: string
  min?: number
  max?: number
}

export interface TestContext {
  readonly board: Board
  /** Aborted when the test times out or the run is aborted. */
  readonly signal: AbortSignal
  /** The first console line matching the pattern since the test started, or since the previous match. */
  waitFor(pattern: LinePattern, options?: { timeoutMs?: number }): Promise<string>
  send(line: string): Promise<void>
  measure(name: string, value: number, options?: MeasureOptions): void
  check(condition: unknown, message: string): void
  log(message: string): void
}

export interface BenchTest {
  name: string
  run: (t: TestContext) => unknown
  timeoutMs?: number
  /** true, or a reason. */
  skip?: boolean | string
}

export type BenchEvent =
  | { type: "flash"; image?: string }
  | { type: "test-start"; name: string }
  | { type: "test-end"; result: TestResult }
  | { type: "measurement"; test: string; measurement: Measurement }

export interface RunOptions {
  board: Board
  tests: readonly BenchTest[]
  image?: string
  /** Per test. Default 30000. */
  timeoutMs?: number
  /** Default true. */
  resetBetween?: boolean
  meta?: RunMeta
  /** Console lines kept with a test that did not pass. Default 40. */
  consoleTail?: number
  signal?: AbortSignal
  onEvent?: (event: BenchEvent) => void
}

function checkOptions(o: RunOptions): void {
  if (!o || typeof o !== "object") throw invalid("options are required")
  if (!o.board || typeof o.board.flash !== "function" || typeof o.board.reset !== "function" || !o.board.console) {
    throw invalid("board must implement the Board interface")
  }
  if (!Array.isArray(o.tests)) throw invalid("tests must be an array")
  const seen = new Set<string>()
  for (const t of o.tests) {
    if (!t || typeof t.name !== "string" || t.name.trim().length === 0) throw invalid("every test needs a name")
    if (typeof t.run !== "function") throw invalid(`test ${JSON.stringify(t.name)} needs a run function`)
    if (seen.has(t.name)) throw invalid(`two tests are named ${JSON.stringify(t.name)}`)
    seen.add(t.name)
    if (t.timeoutMs !== undefined && !(Number.isFinite(t.timeoutMs) && t.timeoutMs > 0)) throw invalid(`test ${JSON.stringify(t.name)}: timeoutMs must be positive`)
  }
  if (o.timeoutMs !== undefined && !(Number.isFinite(o.timeoutMs) && o.timeoutMs > 0)) throw invalid("timeoutMs must be positive")
  if (o.image !== undefined && (typeof o.image !== "string" || o.image.length === 0)) throw invalid("image must be a non-empty string")
  if (o.meta !== undefined && (typeof o.meta !== "object" || !Object.values(o.meta).every((v) => v === undefined || typeof v === "string"))) {
    throw invalid("meta values must be strings")
  }
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

export async function runBench(options: RunOptions): Promise<BenchRun> {
  checkOptions(options)
  const { board, tests } = options
  const defaultTimeout = options.timeoutMs ?? 30_000
  const resetBetween = options.resetBetween ?? true
  const tailSize = options.consoleTail ?? 40
  const emit = (e: BenchEvent) => {
    try {
      options.onEvent?.(e)
    } catch {
      // A broken progress callback must not change the results.
    }
  }
  const meta: RunMeta = {}
  for (const [k, v] of Object.entries(options.meta ?? {})) if (typeof v === "string") meta[k] = v
  const startedAt = new Date().toISOString()
  const t0 = performance.now()
  const results: TestResult[] = []

  const consoleSince = (mark: number) => {
    const lines = board.console.lines
    const first = mark - (board.console.mark() - lines.length)
    return lines.slice(Math.max(0, first)).slice(-tailSize)
  }

  // Boot lines often arrive while the flash or reset program is still running, so the first test reads the console
  // from before setup, and each later test from before its own reset.
  const setupMark = board.console.mark()
  let setupError: string | undefined
  try {
    emit(options.image !== undefined ? { type: "flash", image: options.image } : { type: "flash" })
    if (options.image !== undefined) await board.flash(options.image)
    else await board.reset()
  } catch (err) {
    setupError = `${options.image !== undefined ? "flash" : "reset"} failed: ${message(err)}`
  }

  let first = true
  for (const [i, test] of tests.entries()) {
    if (setupError !== undefined) {
      results.push({ name: test.name, status: "error", durationMs: 0, message: setupError, measurements: [], notes: [], consoleTail: board.console.tail(tailSize) })
      continue
    }
    if (options.signal?.aborted || test.skip) {
      const reason = options.signal?.aborted ? "run aborted" : typeof test.skip === "string" ? test.skip : "skipped"
      results.push({ name: test.name, status: "skip", durationMs: 0, message: reason, measurements: [], notes: [], consoleTail: [] })
      continue
    }
    emit({ type: "test-start", name: test.name })
    const reset = i > 0 && resetBetween
    const startMark = first ? setupMark : board.console.mark()
    first = false
    const result = await runOne(board, test, reset, startMark, test.timeoutMs ?? defaultTimeout, options.signal, emit, consoleSince)
    results.push(result)
    emit({ type: "test-end", result })
  }

  const run: BenchRun = { version: 1, board: board.name, meta, startedAt, durationMs: Math.round(performance.now() - t0), passed: runPassed(results), tests: results }
  if (options.image !== undefined) run.image = options.image
  return run
}

async function runOne(
  board: Board,
  test: BenchTest,
  reset: boolean,
  mark: number,
  timeoutMs: number,
  runSignal: AbortSignal | undefined,
  emit: (e: BenchEvent) => void,
  consoleSince: (mark: number) => string[],
): Promise<TestResult> {
  const started = performance.now()
  const measurements: Measurement[] = []
  const failures: string[] = []
  const notes: string[] = []
  const controller = new AbortController()
  const onRunAbort = () => controller.abort()
  runSignal?.addEventListener("abort", onRunAbort, { once: true })
  let cursor = mark

  const ctx: TestContext = {
    board,
    signal: controller.signal,
    async waitFor(pattern, opts = {}) {
      const hit = await board.console.waitFor(pattern, { since: cursor, signal: controller.signal, ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}) })
      cursor = hit.index + 1
      return hit.line
    },
    send: (line) => board.send(line),
    measure(name, value, opts = {}) {
      if (typeof name !== "string" || name.length === 0) throw invalid("a measurement needs a name")
      if (typeof value !== "number") throw invalid(`measurement ${JSON.stringify(name)} must be a number`)
      const ok = Number.isFinite(value) && (opts.min === undefined || value >= opts.min) && (opts.max === undefined || value <= opts.max)
      const m: Measurement = { name, value, ok }
      if (opts.unit !== undefined) m.unit = opts.unit
      if (opts.min !== undefined) m.min = opts.min
      if (opts.max !== undefined) m.max = opts.max
      measurements.push(m)
      emit({ type: "measurement", test: test.name, measurement: m })
    },
    check(condition, msg) {
      if (!condition) failures.push(msg)
    },
    log(msg) {
      notes.push(String(msg))
    },
  }

  let status: TestStatus = "pass"
  let msg: string | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    if (reset) await board.reset()
    const timedOut = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), timeoutMs)
    })
    const body = Promise.resolve().then(() => test.run(ctx))
    // The body keeps running after a timeout; its later rejection is expected and must not go unhandled.
    body.catch(() => {})
    const outcome = await Promise.race([body.then(() => "done" as const), timedOut])
    if (outcome === "timeout") {
      status = "timeout"
      msg = `timed out after ${timeoutMs} ms`
      controller.abort()
    }
  } catch (err) {
    status = "error"
    msg = err instanceof BenchError && err.code === "CLOSED" && runSignal?.aborted ? "run aborted" : message(err)
  } finally {
    clearTimeout(timer)
    runSignal?.removeEventListener("abort", onRunAbort)
  }

  if (status === "pass") {
    const outOfLimits = measurements.filter((m) => !m.ok).map((m) => describeLimit(m))
    if (failures.length || outOfLimits.length) {
      status = "fail"
      msg = [...failures, ...outOfLimits].join("; ")
    }
  }
  const result: TestResult = {
    name: test.name,
    status,
    durationMs: Math.round(performance.now() - started),
    measurements,
    notes,
    consoleTail: status === "pass" ? [] : consoleSince(mark),
  }
  if (msg !== undefined) result.message = msg
  return result
}

function describeLimit(m: Measurement): string {
  const unit = m.unit ? ` ${m.unit}` : ""
  if (!Number.isFinite(m.value)) return `${m.name} is not a number`
  const range = m.min !== undefined && m.max !== undefined ? `${m.min}..${m.max}` : m.min !== undefined ? `>= ${m.min}` : `<= ${m.max}`
  return `${m.name} = ${m.value}${unit}, outside ${range}${unit}`
}
