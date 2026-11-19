// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// JSONL recording: one measurement per line, appended, so a run can be stopped at any point and the file is still
// readable up to the last complete line.

import { createWriteStream, readFileSync, type WriteStream } from "node:fs"

import { invalid, ProbeError } from "./errors.ts"
import { validateMeasurement, type Measurement } from "./measurement.ts"

export class JsonlRecorder {
  readonly path: string
  lines = 0
  #stream: WriteStream
  #closed = false
  #error: Error | null = null

  /** Opens `path` for appending (created if missing). */
  constructor(path: string) {
    if (typeof path !== "string" || path.length === 0) throw invalid("recorder path must be a non-empty string")
    this.path = path
    this.#stream = createWriteStream(path, { flags: "a", encoding: "utf8" })
    this.#stream.on("error", (err) => {
      this.#error = err
    })
  }

  /** Validates and appends one measurement. Throws if the recorder is closed or the file failed. */
  write(m: Measurement): void {
    if (this.#closed) throw new ProbeError("CLOSED", `recorder for ${this.path} is closed`)
    if (this.#error) throw new ProbeError("CONNECTION", `recording to ${this.path} failed: ${this.#error.message}`, { cause: this.#error })
    const v = validateMeasurement(m)
    this.#stream.write(`${JSON.stringify({ quantity: v.quantity, value: v.value, unit: v.unit, t: v.t, instrument: v.instrument })}\n`)
    this.lines++
  }

  /** Flushes and closes the file. */
  close(): Promise<void> {
    if (this.#closed) return Promise.resolve()
    this.#closed = true
    return new Promise((resolve, reject) => {
      this.#stream.end(() => (this.#error ? reject(this.#error) : resolve()))
    })
  }
}

/**
 * Reads a JSONL recording back as typed measurements. A torn last line (from a run that was killed mid-write) is
 * ignored; any other bad line throws with its line number.
 */
export function readRecording(path: string): Measurement[] {
  const text = readFileSync(path, "utf8")
  const lines = text.split("\n")
  const out: Measurement[] = []
  lines.forEach((line, i) => {
    if (line.trim() === "") return
    const last = i === lines.length - 1
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      if (last) return
      throw new ProbeError("BAD_REPLY", `${path}:${i + 1}: not valid JSON`)
    }
    try {
      out.push(validateMeasurement(parsed))
    } catch (err) {
      throw new ProbeError("UNIT", `${path}:${i + 1}: ${(err as Error).message}`)
    }
  })
  return out
}
