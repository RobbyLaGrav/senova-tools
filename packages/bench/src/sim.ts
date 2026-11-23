// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// A simulated board with a tiny line protocol, so tests and examples run without hardware. Readings are generated
// from a seeded generator: the same seed and the same sequence of commands give the same lines.
import type { Board } from "./board.ts"
import { checkBoardName, checkLine } from "./board.ts"
import { BenchError, invalid } from "./errors.ts"
import { LineBuffer } from "./lines.ts"

export interface SimFaults {
  /** Prints `boot failed` instead of `boot <image> ok`. */
  bootFails?: boolean
  /** Added to a rail's value, in volts. */
  railOffset?: Record<string, number>
  /** Never answers commands (it still prints its boot line). */
  silent?: boolean
  /** `flash` throws `BOARD`. */
  flashFails?: boolean
}

export interface SimBoardOptions {
  name?: string
  seed?: number
  /** Rail name to volts. Default `{ "3v3": 3.3 }`. */
  rails?: Record<string, number>
  /** Uniform noise on each rail reading, ± volts. Default 0.005. */
  noise?: number
  /** Time from flash or reset to the boot line. Default 20 ms. */
  bootMs?: number
  faults?: SimFaults
}

/** mulberry32: small, fast and deterministic; plenty for simulated noise. */
function generator(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export class SimBoard implements Board {
  readonly name: string
  readonly console = new LineBuffer()
  readonly rails: Readonly<Record<string, number>>
  readonly noise: number
  readonly bootMs: number
  readonly faults: SimFaults
  /** Every flash and reset, in order, for tests to check. */
  readonly history: string[] = []
  #random: () => number
  #image = "none"
  #booted = false
  #timers = new Set<ReturnType<typeof setTimeout>>()
  #closed = false

  constructor(options: SimBoardOptions = {}) {
    this.name = checkBoardName(options.name ?? "sim")
    this.rails = { ...(options.rails ?? { "3v3": 3.3 }) }
    for (const [rail, volts] of Object.entries(this.rails)) {
      if (!/^[\w.-]+$/.test(rail) || !Number.isFinite(volts)) throw invalid(`rail ${JSON.stringify(rail)} needs a simple name and a finite value`)
    }
    this.noise = options.noise ?? 0.005
    this.bootMs = options.bootMs ?? 20
    if (!(this.noise >= 0) || !(this.bootMs >= 0)) throw invalid("noise and bootMs must be non-negative")
    this.faults = { ...options.faults }
    this.#random = generator(options.seed ?? 1)
  }

  async flash(image: string): Promise<void> {
    if (typeof image !== "string" || image.length === 0) throw invalid("image must be a non-empty path")
    this.#open()
    this.history.push(`flash ${image}`)
    if (this.faults.flashFails) throw new BenchError("BOARD", `${this.name}: flash failed (simulated)`)
    this.#image = image.split(/[\\/]/).pop() || image
    this.#boot()
  }

  async reset(): Promise<void> {
    this.#open()
    this.history.push("reset")
    this.#boot()
  }

  async send(line: string): Promise<void> {
    checkLine(line)
    this.#open()
    if (!this.#booted || this.faults.silent) return
    const reply = this.#answer(line.trim())
    this.#later(1, () => this.console.push(reply + "\n"))
  }

  async close(): Promise<void> {
    this.#closed = true
    for (const t of this.#timers) clearTimeout(t)
    this.#timers.clear()
  }

  #answer(command: string): string {
    if (command === "ping") return "pong"
    if (command === "version") return `version ${this.#image}`
    const rail = /^rail ([\w.-]+)$/.exec(command)?.[1]
    if (rail !== undefined) {
      const base = this.rails[rail]
      if (base === undefined) return "err unknown rail"
      const value = base + (this.faults.railOffset?.[rail] ?? 0) + (this.#random() * 2 - 1) * this.noise
      return `rail ${rail} ${value.toFixed(4)}`
    }
    return "err unknown"
  }

  #boot(): void {
    this.#booted = false
    for (const t of this.#timers) clearTimeout(t)
    this.#timers.clear()
    this.#later(this.bootMs, () => {
      if (this.faults.bootFails) {
        this.console.push("boot failed\n")
        return
      }
      this.#booted = true
      this.console.push(`boot ${this.#image} ok\n`)
    })
  }

  #later(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.#timers.delete(t)
      if (!this.#closed) fn()
    }, ms)
    this.#timers.add(t)
  }

  #open(): void {
    if (this.#closed) throw new BenchError("CLOSED", `${this.name} is closed`)
  }
}
