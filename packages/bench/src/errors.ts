// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors

export type BenchErrorCode =
  | "INVALID_ARGUMENT"
  | "TIMEOUT"
  | "BOARD"
  | "COMMAND_FAILED"
  | "LOCKED"
  | "BAD_RESULTS"
  | "CLOSED"

/** Every error Bench throws, with a stable `code` to branch on. */
export class BenchError extends Error {
  readonly code: BenchErrorCode
  constructor(code: BenchErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "BenchError"
    this.code = code
  }
}

export function invalid(message: string): BenchError {
  return new BenchError("INVALID_ARGUMENT", message)
}
