// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// A polling scheduler with backpressure. Reads run on a fixed interval, never two at once. When a read is still
// running at the next tick, the tick is either skipped or coalesced into a single catch-up read that starts as soon
// as the slow one finishes, so a slow instrument never builds up a backlog.

import { invalid } from "./errors.ts"
import { validateMeasurement, type Measurement } from "./measurement.ts"

export type PollRead = () => Promise<Measurement | Measurement[]>

export interface PollerOptions {
  /** Time between reads in ms (at least 10). */
  intervalMs: number
  /** Called once per tick; returns one or more measurements. */
  read: PollRead
  /** Receives every measurement, in order. */
  onMeasurement?: (m: Measurement) => void
  /** Receives read errors (and errors thrown by onMeasurement). Polling continues. */
  onError?: (err: Error) => void
  /**
   * What to do when a tick arrives while the previous read is still running. "skip" (default) drops the tick;
   * "coalesce" runs one extra read straight after the slow one, however many ticks were missed.
   */
  overrun?: "skip" | "coalesce"
}

export interface PollerStats {
  ticks: number
  reads: number
  measurements: number
  skipped: number
  /** Ticks folded into a catch-up read (coalesce mode). */
  coalesced: number
  errors: number
}

export class Poller {
  readonly intervalMs: number
  readonly overrun: "skip" | "coalesce"
  readonly stats: PollerStats = { ticks: 0, reads: 0, measurements: 0, skipped: 0, coalesced: 0, errors: 0 }
  lastError: Error | null = null

  #read: PollRead
  #onMeasurement: ((m: Measurement) => void) | undefined
  #onError: ((err: Error) => void) | undefined
  #timer: NodeJS.Timeout | null = null
  #inFlight: Promise<void> | null = null
  #pending = false
  #running = false

  constructor(options: PollerOptions) {
    if (!options || typeof options !== "object") throw invalid("Poller needs options")
    const { intervalMs, read, overrun = "skip" } = options
    if (typeof intervalMs !== "number" || !Number.isFinite(intervalMs) || intervalMs < 10) {
      throw invalid("intervalMs must be a number of at least 10")
    }
    if (typeof read !== "function") throw invalid("read must be a function returning measurements")
    if (overrun !== "skip" && overrun !== "coalesce") throw invalid('overrun must be "skip" or "coalesce"')
    this.intervalMs = intervalMs
    this.overrun = overrun
    this.#read = read
    this.#onMeasurement = options.onMeasurement
    this.#onError = options.onError
  }

  get running(): boolean {
    return this.#running
  }

  /** Starts polling: one read now, then one per interval. */
  start(): this {
    if (this.#running) return this
    this.#running = true
    this.#tick()
    this.#timer = setInterval(() => this.#tick(), this.intervalMs)
    return this
  }

  /** Stops ticking and resolves once the read in progress (if any) has finished and been delivered. */
  async stop(): Promise<void> {
    this.#running = false
    this.#pending = false
    if (this.#timer) clearInterval(this.#timer)
    this.#timer = null
    while (this.#inFlight) await this.#inFlight
  }

  #tick(): void {
    if (!this.#running) return
    this.stats.ticks++
    if (this.#inFlight) {
      if (this.overrun === "skip") this.stats.skipped++
      else {
        // Every missed tick folds into one catch-up read.
        this.stats.coalesced++
        this.#pending = true
      }
      return
    }
    this.#run()
  }

  #run(): void {
    this.stats.reads++
    this.#inFlight = (async () => {
      try {
        const out = await this.#read()
        const list = Array.isArray(out) ? out : [out]
        for (const m of list) {
          const valid = validateMeasurement(m)
          this.stats.measurements++
          this.#onMeasurement?.(valid)
        }
      } catch (err) {
        this.#fail(err)
      }
    })().finally(() => {
      this.#inFlight = null
      if (this.#pending && this.#running) {
        this.#pending = false
        this.#run()
      }
    })
  }

  #fail(err: unknown): void {
    const e = err instanceof Error ? err : new Error(String(err))
    this.stats.errors++
    this.lastError = e
    try {
      this.#onError?.(e)
    } catch {
      // An error handler that throws must not stop polling.
    }
  }
}
