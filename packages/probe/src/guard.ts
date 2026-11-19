// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// The command guard: every command a driver sends passes through here first. Writes must match an allow-list rule
// and stay inside its limits; queries must match an allowed query pattern (some queries act, e.g. *CAL? runs a
// calibration). Anything else is refused before it reaches the socket.

import { invalid, ProbeError } from "./errors.ts"
import { SI_UNITS, type Quantity } from "./measurement.ts"
import { compilePattern, matchHeader, parseCommand, type HeaderPattern, type ParsedCommand } from "./syntax.ts"

export interface WriteRule {
  /** Manual-style header pattern, e.g. "[SOURce:]VOLTage[:LEVel]". */
  pattern: string
  /** The single argument must be a plain number within [min, max] (min defaults to 0). */
  limit?: { max: number; min?: number; quantity?: Quantity }
  /** The single argument must be one of these words (compared case-insensitively), e.g. ["ON", "OFF", "1", "0"]. */
  values?: string[]
  /** Accept any arguments. Off by default: a rule without limit or values accepts the bare header only. */
  anyArgs?: boolean
}

export interface GuardOptions {
  writes?: WriteRule[]
  queries?: string[]
}

interface CompiledRule {
  rule: WriteRule
  pattern: HeaderPattern
  values: Set<string> | null
}

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/

export class CommandGuard {
  readonly #writes: CompiledRule[] = []
  readonly #queries: HeaderPattern[] = []

  constructor(options: GuardOptions = {}) {
    for (const rule of options.writes ?? []) this.allowWrite(rule)
    for (const q of options.queries ?? []) this.allowQuery(q)
  }

  allowWrite(rule: WriteRule): void {
    if (rule === null || typeof rule !== "object") throw invalid("a write rule must be an object")
    const pattern = compilePattern(rule.pattern)
    if (pattern.query) throw invalid(`write rule "${rule.pattern}" is a query pattern: use allowQuery`)
    if (rule.limit !== undefined) {
      const { max, min = 0 } = rule.limit
      if (typeof max !== "number" || !Number.isFinite(max)) throw invalid(`limit.max for "${rule.pattern}" must be a finite number`)
      if (typeof min !== "number" || !Number.isFinite(min) || min > max) {
        throw invalid(`limit.min for "${rule.pattern}" must be a finite number no larger than max`)
      }
    }
    if (rule.values !== undefined && (!Array.isArray(rule.values) || rule.values.some((v) => typeof v !== "string" || v === ""))) {
      throw invalid(`values for "${rule.pattern}" must be non-empty strings`)
    }
    this.#writes.push({ rule, pattern, values: rule.values ? new Set(rule.values.map((v) => v.toUpperCase())) : null })
  }

  allowQuery(pattern: string): void {
    const p = compilePattern(pattern)
    if (!p.query) throw invalid(`query pattern "${pattern}" must end in "?"`)
    this.#queries.push(p)
  }

  /** Throws WRITE_REFUSED when the query isn't allowed. Returns the parsed command. */
  checkQuery(command: string): ParsedCommand {
    const cmd = parseCommand(command)
    if (!cmd.query) throw new ProbeError("INVALID_COMMAND", `"${command}" is not a query`)
    if (!this.#queries.some((p) => matchHeader(p, cmd.header))) {
      throw new ProbeError("WRITE_REFUSED", `query "${command.trim()}" is not on this instrument's allow list`)
    }
    return cmd
  }

  /**
   * Throws WRITE_REFUSED when no rule allows the write, or LIMIT_EXCEEDED when the value is outside a matching rule's
   * limits. When several rules match, the write must satisfy all of them, so adding a loose rule can't widen a limit.
   */
  checkWrite(command: string): ParsedCommand {
    const cmd = parseCommand(command)
    if (cmd.query) throw new ProbeError("INVALID_COMMAND", `"${command}" is a query, not a write`)
    const matching = this.#writes.filter((r) => matchHeader(r.pattern, cmd.header))
    const shown = command.trim()
    if (matching.length === 0) throw new ProbeError("WRITE_REFUSED", `write "${shown}" is not on this instrument's allow list`)
    for (const { rule, values } of matching) {
      if (rule.limit) {
        if (!NUMBER.test(cmd.args)) {
          throw new ProbeError(
            "LIMIT_EXCEEDED",
            `write "${shown}" refused: "${rule.pattern}" takes one plain number (MIN, MAX, DEF and unit suffixes are refused)`,
          )
        }
        const v = Number(cmd.args)
        const { max, min = 0, quantity } = rule.limit
        const unit = quantity ? ` ${SI_UNITS[quantity]}` : ""
        if (!Number.isFinite(v) || v > max) {
          throw new ProbeError("LIMIT_EXCEEDED", `write "${shown}" refused: above the configured maximum of ${max}${unit}`)
        }
        if (v < min) throw new ProbeError("LIMIT_EXCEEDED", `write "${shown}" refused: below the configured minimum of ${min}${unit}`)
      } else if (values) {
        if (!values.has(cmd.args.toUpperCase())) {
          throw new ProbeError("WRITE_REFUSED", `write "${shown}" refused: argument must be one of ${[...values].join(", ")}`)
        }
      } else if (!rule.anyArgs && cmd.args !== "") {
        throw new ProbeError("WRITE_REFUSED", `write "${shown}" refused: "${rule.pattern}" takes no arguments`)
      }
    }
    return cmd
  }
}
