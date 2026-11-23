// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// A board console as a list of lines that tests can wait on. Lines are numbered from the start of the buffer's life,
// so a test can say "a match after line N" even after old lines have been dropped.
import { BenchError, invalid } from "./errors.ts"

export type LinePattern = string | RegExp

export interface WaitOptions {
  /** Default 5000. */
  timeoutMs?: number
  /** Only lines with an index at or after this (from `mark()`). Default: every line still kept. */
  since?: number
  signal?: AbortSignal
}

export interface LineHit {
  line: string
  index: number
}

interface Waiter {
  test: (line: string) => boolean
  since: number
  resolve: (hit: LineHit) => void
}

export function describePattern(pattern: LinePattern): string {
  return typeof pattern === "string" ? JSON.stringify(pattern) : String(pattern)
}

function matcher(pattern: LinePattern): (line: string) => boolean {
  if (typeof pattern === "string") return (line) => line === pattern
  if (pattern instanceof RegExp) {
    // A global or sticky RegExp keeps lastIndex between calls, which would make matches depend on history.
    const re = new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ""))
    return (line) => re.test(line)
  }
  throw invalid("pattern must be a string or a RegExp")
}

export class LineBuffer {
  readonly maxLines: number
  #lines: string[] = []
  #dropped = 0
  #partial = ""
  #waiters = new Set<Waiter>()

  constructor(maxLines = 2000) {
    if (!Number.isInteger(maxLines) || maxLines < 1) throw invalid("maxLines must be a positive integer")
    this.maxLines = maxLines
  }

  /** Lines still kept, oldest first. */
  get lines(): readonly string[] {
    return this.#lines
  }

  /** The index the next complete line will get. */
  mark(): number {
    return this.#dropped + this.#lines.length
  }

  tail(n: number): string[] {
    return n <= 0 ? [] : this.#lines.slice(-n)
  }

  /** Adds console text. Splits on `\n`, drops a trailing `\r`, and holds an unfinished last line until it ends. */
  push(text: string): void {
    const parts = (this.#partial + text).split("\n")
    this.#partial = parts.pop() ?? ""
    for (const raw of parts) this.#add(raw.endsWith("\r") ? raw.slice(0, -1) : raw)
    // A console that never sends a newline must not grow without bound.
    if (this.#partial.length > 65536) {
      this.#add(this.#partial)
      this.#partial = ""
    }
  }

  #add(line: string): void {
    const index = this.mark()
    this.#lines.push(line)
    if (this.#lines.length > this.maxLines) {
      this.#lines.shift()
      this.#dropped++
    }
    for (const w of this.#waiters) {
      if (index >= w.since && w.test(line)) w.resolve({ line, index })
    }
  }

  /** Resolves with the first line at or after `since` that matches. Throws `TIMEOUT`, or `CLOSED` when aborted. */
  waitFor(pattern: LinePattern, options: WaitOptions = {}): Promise<LineHit> {
    const test = matcher(pattern)
    const timeoutMs = options.timeoutMs ?? 5000
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) throw invalid("timeoutMs must be a non-negative number")
    const since = options.since ?? this.#dropped
    for (let i = Math.max(0, since - this.#dropped); i < this.#lines.length; i++) {
      const line = this.#lines[i] as string
      if (test(line)) return Promise.resolve({ line, index: this.#dropped + i })
    }
    const signal = options.signal
    if (signal?.aborted) return Promise.reject(new BenchError("CLOSED", `stopped waiting for ${describePattern(pattern)}`))
    return new Promise((resolve, reject) => {
      const done = () => {
        clearTimeout(timer)
        signal?.removeEventListener("abort", onAbort)
        this.#waiters.delete(waiter)
      }
      const waiter: Waiter = {
        test,
        since,
        resolve: (hit) => {
          done()
          resolve(hit)
        },
      }
      const timer = setTimeout(() => {
        done()
        reject(new BenchError("TIMEOUT", `no console line matched ${describePattern(pattern)} within ${timeoutMs} ms`))
      }, timeoutMs)
      const onAbort = () => {
        done()
        reject(new BenchError("CLOSED", `stopped waiting for ${describePattern(pattern)}`))
      }
      signal?.addEventListener("abort", onAbort, { once: true })
      this.#waiters.add(waiter)
    })
  }
}
