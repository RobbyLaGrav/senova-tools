// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
import assert from "node:assert/strict"
import { test } from "node:test"

import { CommandGuard, compilePattern, matches, parseCommand, ProbeError, validateCommand } from "../src/index.ts"

const code = (c: string) => (err: unknown) => err instanceof ProbeError && err.code === c

test("validateCommand refuses newlines, control characters, compound commands and non-ASCII", () => {
  assert.equal(validateCommand("  *IDN?  "), "*IDN?")
  assert.throws(() => validateCommand("VOLT 1\nOUTP ON"), code("INVALID_COMMAND"))
  assert.throws(() => validateCommand("VOLT 1\r"), code("INVALID_COMMAND"))
  assert.throws(() => validateCommand("VOLT 1;OUTP ON"), code("INVALID_COMMAND"))
  assert.throws(() => validateCommand("VOLT 1 "), code("INVALID_COMMAND"))
  assert.throws(() => validateCommand(""), code("INVALID_COMMAND"))
  assert.throws(() => validateCommand("X".repeat(513)), code("INVALID_COMMAND"))
  assert.throws(() => validateCommand(42), code("INVALID_COMMAND"))
})

test("parseCommand splits header, query flag and arguments", () => {
  assert.deepEqual(parseCommand(":SOUR:VOLT 5.0"), { header: "SOUR:VOLT", query: false, args: "5.0" })
  assert.deepEqual(parseCommand("MEAS:VOLT:DC?"), { header: "MEAS:VOLT:DC", query: true, args: "" })
  assert.throws(() => parseCommand("VOLT::LEV 1"), code("INVALID_COMMAND"))
})

test("patterns accept short and long forms in any case, with optional nodes", () => {
  const p = compilePattern("[SOURce:]VOLTage[:LEVel][:IMMediate][:AMPLitude]")
  for (const c of ["VOLT 1", "volt 1", "VOLTAGE 1", "SOUR:VOLT 1", "source:voltage:level 1", ":SOUR:VOLT:LEV:IMM:AMPL 1"]) {
    assert.ok(matches(p, parseCommand(c)), c)
  }
  for (const c of ["VOLTA 1", "VOL 1", "CURR 1", "SOUR:CURR 1", "VOLT:PROT 1", "VOLT? "]) {
    assert.ok(!matches(p, parseCommand(c)), c)
  }
  assert.ok(matches("MEASure[:SCALar]:VOLTage[:DC]?", parseCommand("MEAS:SCAL:VOLT:DC?")))
  assert.ok(matches("*IDN?", parseCommand("*idn?")))
  assert.throws(() => compilePattern("[SOUR:"), code("INVALID_ARGUMENT"))
  assert.throws(() => compilePattern("[SOUR]"), code("INVALID_ARGUMENT"))
})

test("guard: writes need an allow-list rule, and every matching rule's limits", () => {
  const g = new CommandGuard({
    writes: [
      { pattern: "VOLTage", limit: { max: 12, quantity: "voltage" } },
      { pattern: "OUTPut", values: ["ON", "OFF"] },
      { pattern: "*CLS" },
    ],
    queries: ["MEAS:VOLT?"],
  })
  assert.equal(g.checkWrite("VOLT 12").args, "12")
  assert.equal(g.checkWrite("*CLS").header, "*CLS")
  assert.throws(() => g.checkWrite("VOLT 12.01"), code("LIMIT_EXCEEDED"))
  assert.throws(() => g.checkWrite("VOLT -1"), code("LIMIT_EXCEEDED"))
  assert.throws(() => g.checkWrite("VOLT MAX"), code("LIMIT_EXCEEDED"))
  assert.throws(() => g.checkWrite("VOLT 5V"), code("LIMIT_EXCEEDED"))
  assert.throws(() => g.checkWrite("VOLT 1e400"), code("LIMIT_EXCEEDED"))
  assert.throws(() => g.checkWrite("OUTP MAYBE"), code("WRITE_REFUSED"))
  assert.throws(() => g.checkWrite("*CLS now"), code("WRITE_REFUSED"))
  assert.throws(() => g.checkWrite("*RST"), code("WRITE_REFUSED"))
  assert.throws(() => g.checkWrite("CAL:SEC:STAT OFF"), code("WRITE_REFUSED"))
  // A looser rule added later can't widen the limit.
  g.allowWrite({ pattern: "VOLTage", anyArgs: true })
  assert.throws(() => g.checkWrite("VOLT 50"), code("LIMIT_EXCEEDED"))
  // Queries need their own allow list.
  assert.ok(g.checkQuery("MEAS:VOLT?"))
  assert.throws(() => g.checkQuery("*CAL?"), code("WRITE_REFUSED"))
  assert.throws(() => g.checkQuery("VOLT 1"), code("INVALID_COMMAND"))
  assert.throws(() => g.allowWrite({ pattern: "VOLT", limit: { max: 1, min: 2 } }), code("INVALID_ARGUMENT"))
  assert.throws(() => g.allowQuery("VOLT"), code("INVALID_ARGUMENT"))
})
