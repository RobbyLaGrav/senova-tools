// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { after, test } from "node:test"

import { JsonlRecorder, measurement, readRecording } from "../src/index.ts"

const dir = mkdtempSync(join(tmpdir(), "probe-test-"))
after(() => rmSync(dir, { recursive: true, force: true }))

test("JSONL: one measurement per line, appended, read back typed", async () => {
  const file = join(dir, "run.jsonl")
  const rec = new JsonlRecorder(file)
  rec.write(measurement({ quantity: "voltage", value: 3.3, t: 1, instrument: "psu1" }))
  rec.write(measurement({ quantity: "current", value: 0.33, t: 2, instrument: "psu1" }))
  assert.throws(() => rec.write({ quantity: "current", value: 1, unit: "V", t: 3, instrument: "x" } as never), /must be in A/)
  await rec.close()
  assert.equal(rec.lines, 2)
  assert.equal(
    readFileSync(file, "utf8"),
    '{"quantity":"voltage","value":3.3,"unit":"V","t":1,"instrument":"psu1"}\n' +
      '{"quantity":"current","value":0.33,"unit":"A","t":2,"instrument":"psu1"}\n',
  )
  assert.throws(() => rec.write(measurement({ quantity: "voltage", value: 1, instrument: "x" })), /closed/)
  const again = new JsonlRecorder(file)
  again.write(measurement({ quantity: "resistance", value: 1000, t: 4, instrument: "dmm1" }))
  await again.close()
  assert.deepEqual(readRecording(file).map((m) => [m.quantity, m.unit]), [["voltage", "V"], ["current", "A"], ["resistance", "Ω"]])
})

test("readRecording ignores a torn last line and names the line of any other bad one", () => {
  const file = join(dir, "torn.jsonl")
  writeFileSync(file, '{"quantity":"voltage","value":1,"unit":"V","t":1,"instrument":"a"}\n{"quantity":"vol')
  assert.equal(readRecording(file).length, 1)
  appendFileSync(file, '\n{"quantity":"voltage","value":1,"unit":"V","t":1,"instrument":"a"}\n')
  assert.throws(() => readRecording(file), /torn\.jsonl:2: not valid JSON/)
  const wrong = join(dir, "wrong.jsonl")
  writeFileSync(wrong, '{"quantity":"voltage","value":1,"unit":"kV","t":1,"instrument":"a"}\n')
  assert.throws(() => readRecording(wrong), /wrong\.jsonl:1: voltage must be in V/)
})

test("the README example runs against the simulators and records JSONL", () => {
  const pkg = join(dirname(fileURLToPath(import.meta.url)), "..")
  const file = join(dir, "bench.jsonl")
  const out = execFileSync(process.execPath, [join(pkg, "examples", "bench.ts"), "0.7", file], { encoding: "utf8", timeout: 30000 })
  assert.match(out, /model: 'SIM-PSU'/)
  assert.match(out, /LIMIT_EXCEEDED write "VOLT 48" refused: above the configured maximum of 12 V/)
  assert.match(out, /Live page: http:\/\/127\.0\.0\.1:\d+\//)
  const rows = readRecording(file)
  assert.ok(rows.length >= 6, String(rows.length))
  const psuV = rows.find((r) => r.instrument === "psu1" && r.quantity === "voltage")!
  const dmmV = rows.find((r) => r.instrument === "dmm1" && r.quantity === "voltage")!
  assert.ok(Math.abs(psuV.value - 3.3) < 0.02)
  assert.ok(Math.abs(dmmV.value - 5) < 0.05)
})
