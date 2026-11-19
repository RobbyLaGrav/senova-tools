// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// SCPI command syntax: validating a command line, splitting it into header and arguments, and matching headers
// against patterns written the way instrument manuals write them, e.g. "[SOURce:]VOLTage[:LEVel]" or "MEASure:VOLTage:DC?".
// In a pattern, the uppercase part of each node is the short form and the whole node is the long form; either is
// accepted, in any case. Nodes in square brackets are optional.

import { ProbeError } from "./errors.ts"

export const MAX_COMMAND_LENGTH = 512

/**
 * Checks one command line before it can reach a socket. Refuses empty commands, control characters (a newline would
 * smuggle a second command), compound commands joined with ";", and anything longer than 512 characters.
 */
export function validateCommand(command: unknown): string {
  if (typeof command !== "string") throw new ProbeError("INVALID_COMMAND", "a SCPI command must be a string")
  const cmd = command.trim()
  if (cmd.length === 0) throw new ProbeError("INVALID_COMMAND", "empty SCPI command")
  if (cmd.length > MAX_COMMAND_LENGTH) {
    throw new ProbeError("INVALID_COMMAND", `SCPI command longer than ${MAX_COMMAND_LENGTH} characters`)
  }
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd.charCodeAt(i)
    if (c < 0x20 || c === 0x7f) {
      throw new ProbeError("INVALID_COMMAND", `SCPI command contains a control character (code ${c}): ${JSON.stringify(cmd)}`)
    }
    if (c > 0x7e) throw new ProbeError("INVALID_COMMAND", `SCPI command must be printable ASCII: ${JSON.stringify(cmd)}`)
  }
  if (cmd.includes(";")) {
    throw new ProbeError("INVALID_COMMAND", `compound commands (";") are refused, send them one at a time: ${cmd}`)
  }
  return cmd
}

export interface ParsedCommand {
  /** Header without a leading ":" and without the trailing "?", e.g. "SOUR:VOLT". */
  header: string
  /** True when the header ends in "?". */
  query: boolean
  /** Everything after the first space, trimmed ("" when there are no arguments). */
  args: string
}

/** Splits a validated command into header, query flag and arguments. */
export function parseCommand(command: string): ParsedCommand {
  const cmd = validateCommand(command)
  const space = cmd.search(/\s/)
  let header = space === -1 ? cmd : cmd.slice(0, space)
  const args = space === -1 ? "" : cmd.slice(space).trim()
  const query = header.endsWith("?")
  if (query) header = header.slice(0, -1)
  if (header.startsWith(":")) header = header.slice(1)
  if (!/^\*?[A-Za-z][A-Za-z0-9]*(:[A-Za-z][A-Za-z0-9]*)*$/.test(header)) {
    throw new ProbeError("INVALID_COMMAND", `malformed SCPI header: ${JSON.stringify(cmd)}`)
  }
  return { header, query, args }
}

interface PatternNode {
  short: string
  long: string
  optional: boolean
}

export interface HeaderPattern {
  source: string
  query: boolean
  nodes: PatternNode[]
}

/** Compiles a manual-style header pattern such as "[SOURce:]VOLTage[:LEVel]" or "MEASure:CURRent:DC?". */
export function compilePattern(pattern: string): HeaderPattern {
  if (typeof pattern !== "string" || pattern.trim() === "") throw new ProbeError("INVALID_ARGUMENT", "empty SCPI pattern")
  let src = pattern.trim()
  const query = src.endsWith("?")
  if (query) src = src.slice(0, -1)
  const nodes: PatternNode[] = []
  const push = (text: string, optional: boolean) => {
    for (const part of text.split(":")) {
      if (part === "") continue
      if (!/^\*?[A-Za-z][A-Za-z0-9]*$/.test(part)) {
        throw new ProbeError("INVALID_ARGUMENT", `bad node "${part}" in SCPI pattern "${pattern}"`)
      }
      const star = part.startsWith("*") ? "*" : ""
      const body = part.slice(star.length)
      const upper = /^[A-Z0-9]*/.exec(body)?.[0] ?? ""
      const short = star + (upper === "" ? body : upper)
      nodes.push({ short: short.toUpperCase(), long: (star + body).toUpperCase(), optional })
    }
  }
  let i = 0
  while (i < src.length) {
    if (src[i] === "[") {
      const end = src.indexOf("]", i)
      if (end === -1) throw new ProbeError("INVALID_ARGUMENT", `unclosed "[" in SCPI pattern "${pattern}"`)
      const inner = src.slice(i + 1, end)
      if (inner.includes("[")) throw new ProbeError("INVALID_ARGUMENT", `nested "[" in SCPI pattern "${pattern}"`)
      push(inner, true)
      i = end + 1
    } else {
      let end = src.indexOf("[", i)
      if (end === -1) end = src.length
      const text = src.slice(i, end)
      if (text.includes("]")) throw new ProbeError("INVALID_ARGUMENT", `stray "]" in SCPI pattern "${pattern}"`)
      push(text, false)
      i = end
    }
  }
  if (nodes.length === 0 || nodes.every((n) => n.optional)) {
    throw new ProbeError("INVALID_ARGUMENT", `SCPI pattern "${pattern}" has no required node`)
  }
  return { source: pattern, query, nodes }
}

/** True when `header` (from parseCommand) matches the pattern's nodes. The query flag is compared separately. */
export function matchHeader(pattern: HeaderPattern, header: string): boolean {
  const input = header.replace(/^:/, "").toUpperCase().split(":")
  const go = (p: number, h: number): boolean => {
    if (p === pattern.nodes.length) return h === input.length
    const node = pattern.nodes[p]!
    const word = input[h]
    if (word !== undefined && (word === node.short || word === node.long) && go(p + 1, h + 1)) return true
    return node.optional && go(p + 1, h)
  }
  return go(0, 0)
}

/** True when the command (header and query flag) matches the pattern. */
export function matches(pattern: HeaderPattern | string, command: ParsedCommand): boolean {
  const p = typeof pattern === "string" ? compilePattern(pattern) : pattern
  return p.query === command.query && matchHeader(p, command.header)
}
