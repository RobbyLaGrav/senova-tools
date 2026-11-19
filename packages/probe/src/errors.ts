// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Error classes. Every error Probe throws is a ProbeError with a stable `code`, so scripts and agents can branch on
// the code instead of parsing messages.

export type ProbeErrorCode =
  | "INVALID_ARGUMENT"
  | "INVALID_COMMAND"
  | "TIMEOUT"
  | "CONNECTION"
  | "CLOSED"
  | "QUEUE_FULL"
  | "BAD_REPLY"
  | "OVERLOAD"
  | "INSTRUMENT_ERROR"
  | "WRITE_REFUSED"
  | "LIMIT_EXCEEDED"
  | "UNIT"

export class ProbeError extends Error {
  readonly code: ProbeErrorCode
  constructor(code: ProbeErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "ProbeError"
    this.code = code
  }
}

/** One entry from the instrument's error queue (SYST:ERR?). */
export interface InstrumentErrorEntry {
  code: number
  message: string
}

/** The instrument reported one or more errors in its error queue after a command. */
export class InstrumentError extends ProbeError {
  readonly errors: InstrumentErrorEntry[]
  readonly command: string
  constructor(command: string, errors: InstrumentErrorEntry[]) {
    super(
      "INSTRUMENT_ERROR",
      `instrument reported ${errors.length === 1 ? "an error" : `${errors.length} errors`} after "${command}": ` +
        errors.map((e) => `${e.code} ${e.message}`).join("; "),
    )
    this.name = "InstrumentError"
    this.errors = errors
    this.command = command
  }
}

export const invalid = (message: string): ProbeError => new ProbeError("INVALID_ARGUMENT", message)
