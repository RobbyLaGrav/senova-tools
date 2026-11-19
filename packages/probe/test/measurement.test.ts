// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
import assert from "node:assert/strict"
import { test } from "node:test"

import { measurement, parseScpiNumber, ProbeError, SI_UNITS, validateMeasurement } from "../src/index.ts"

const code = (c: string) => (err: unknown) => err instanceof ProbeError && err.code === c

test("measurement() fills in the SI unit and refuses a wrong one", () => {
  const m = measurement({ quantity: "voltage", value: 1.5, t: 10, instrument: "dmm1" })
  assert.deepEqual(m, { quantity: "voltage", value: 1.5, unit: "V", t: 10, instrument: "dmm1" })
  assert.equal(measurement({ quantity: "resistance", value: 1, instrument: "x" }).unit, "Ω")
  assert.throws(() => measurement({ quantity: "voltage", value: 1, unit: "mV", instrument: "x" }), code("UNIT"))
  assert.throws(() => measurement({ quantity: "current", value: 1, unit: "V", instrument: "x" }), code("UNIT"))
  assert.throws(() => measurement({ quantity: "temperature", value: 20, unit: "°C", instrument: "x" }), code("UNIT"))
  assert.throws(() => measurement({ quantity: "speed", value: 1, instrument: "x" }), code("UNIT"))
  assert.throws(() => measurement({ quantity: "voltage", value: Number.NaN, instrument: "x" }), code("UNIT"))
  assert.throws(() => measurement({ quantity: "voltage", value: 1, instrument: "" }), code("UNIT"))
  assert.equal(SI_UNITS.frequency, "Hz")
})

test("validateMeasurement checks untrusted objects and drops extra fields", () => {
  const ok = validateMeasurement({ quantity: "power", value: 2, unit: "W", t: 1, instrument: "a", extra: "<script>" })
  assert.deepEqual(ok, { quantity: "power", value: 2, unit: "W", t: 1, instrument: "a" })
  for (const bad of [null, [], "x", { quantity: "power", value: 2, unit: "W", t: -1, instrument: "a" }, { quantity: "toString", value: 1, unit: "V", t: 1, instrument: "a" }]) {
    assert.throws(() => validateMeasurement(bad), code("UNIT"))
  }
})

test("parseScpiNumber accepts NR1/NR2/NR3 and refuses text, suffixes and over-range", () => {
  assert.equal(parseScpiNumber("+5.00012000E+00"), 5.00012)
  assert.equal(parseScpiNumber(" -12 "), -12)
  assert.equal(parseScpiNumber(".5"), 0.5)
  assert.equal(parseScpiNumber("1e-3"), 0.001)
  for (const bad of ["", "abc", "5 V", "5V", "1,2", "NaN", "0x10", "--1"]) {
    assert.throws(() => parseScpiNumber(bad), code("BAD_REPLY"), bad)
  }
  assert.throws(() => parseScpiNumber("+9.90000000E+37"), code("OVERLOAD"))
  assert.throws(() => parseScpiNumber("-9.9E37"), code("OVERLOAD"))
  assert.throws(() => parseScpiNumber("1e999"), code("BAD_REPLY"))
})
