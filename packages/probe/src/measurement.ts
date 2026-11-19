// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Typed measurements: {quantity, value, unit, t, instrument}, with the unit checked against the quantity's SI unit,
// and parsing of SCPI numeric replies (NR1, NR2, NR3, including the 9.9E37 overload value).

import { ProbeError } from "./errors.ts"

/** The SI unit for each quantity Probe knows. A measurement's unit must be the one listed here. */
export const SI_UNITS = {
  voltage: "V",
  current: "A",
  resistance: "Ω",
  power: "W",
  frequency: "Hz",
  capacitance: "F",
  temperature: "K",
  time: "s",
} as const

export type Quantity = keyof typeof SI_UNITS
export type SiUnit = (typeof SI_UNITS)[Quantity]

export interface Measurement {
  quantity: Quantity
  value: number
  unit: SiUnit
  /** Milliseconds since the Unix epoch, taken when the reply arrived. */
  t: number
  /** Which instrument produced it, e.g. "dmm1" or "SIM-DMM SIM0001". */
  instrument: string
}

const isQuantity = (q: unknown): q is Quantity => typeof q === "string" && Object.hasOwn(SI_UNITS, q)

/** Builds a measurement, refusing unknown quantities, a unit that isn't the quantity's SI unit, and non-finite values. */
export function measurement(fields: {
  quantity: string
  value: number
  unit?: string
  t?: number
  instrument: string
}): Measurement {
  return validateMeasurement({ ...fields, unit: fields.unit ?? (isQuantity(fields.quantity) ? SI_UNITS[fields.quantity] : undefined), t: fields.t ?? Date.now() })
}

/** Checks an unknown value (for example a parsed JSONL line) is a well-formed Measurement and returns it typed. */
export function validateMeasurement(m: unknown): Measurement {
  if (m === null || typeof m !== "object" || Array.isArray(m)) throw new ProbeError("UNIT", "a measurement must be an object")
  const r = m as Record<string, unknown>
  if (!isQuantity(r.quantity)) {
    throw new ProbeError("UNIT", `unknown quantity ${JSON.stringify(r.quantity)} (known: ${Object.keys(SI_UNITS).join(", ")})`)
  }
  const want = SI_UNITS[r.quantity]
  if (r.unit !== want) {
    throw new ProbeError("UNIT", `${r.quantity} must be in ${want}, got ${JSON.stringify(r.unit)}`)
  }
  if (typeof r.value !== "number" || !Number.isFinite(r.value)) {
    throw new ProbeError("UNIT", `measurement value must be a finite number, got ${JSON.stringify(r.value)}`)
  }
  if (typeof r.t !== "number" || !Number.isFinite(r.t) || r.t < 0) {
    throw new ProbeError("UNIT", `measurement t must be milliseconds since the epoch, got ${JSON.stringify(r.t)}`)
  }
  if (typeof r.instrument !== "string" || r.instrument.length === 0 || r.instrument.length > 200) {
    throw new ProbeError("UNIT", "measurement instrument must be a non-empty string of at most 200 characters")
  }
  return { quantity: r.quantity, value: r.value, unit: want, t: r.t, instrument: r.instrument }
}

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/

/** SCPI instruments report an over-range reading as 9.9E37 (and -9.9E37). */
export const SCPI_OVERLOAD = 9.9e37

/**
 * Parses a SCPI numeric reply. Throws BAD_REPLY for anything that isn't a plain number (units suffixes, text, empty)
 * and OVERLOAD for the 9.9E37 over-range value, so an over-range reading never becomes a real-looking number.
 */
export function parseScpiNumber(reply: string, command = "query"): number {
  const s = reply.trim()
  if (!NUMBER.test(s)) throw new ProbeError("BAD_REPLY", `expected a number in reply to "${command}", got ${JSON.stringify(reply.slice(0, 80))}`)
  const v = Number(s)
  if (!Number.isFinite(v)) throw new ProbeError("BAD_REPLY", `number out of range in reply to "${command}": ${s}`)
  if (Math.abs(v) >= SCPI_OVERLOAD * 0.999) throw new ProbeError("OVERLOAD", `instrument reported over-range in reply to "${command}"`)
  return v
}
