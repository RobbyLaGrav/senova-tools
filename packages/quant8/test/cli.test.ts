// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Runs the README's two-minute example through the CLI and checks its failure modes.
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"
import { fileURLToPath } from "node:url"

import { main, type CliIo } from "../src/cli.ts"

const pkg = fileURLToPath(new URL("..", import.meta.url))
const work = mkdtempSync(join(tmpdir(), "quant8-cli-"))
after(() => rmSync(work, { recursive: true, force: true }))

async function cli(...args: string[]) {
  const out: string[] = []
  const err: string[] = []
  const io: CliIo = { stdout: (l) => out.push(l), stderr: (l) => err.push(l), cwd: pkg }
  const code = await main(args, io)
  return { code, out: out.join("\n"), err: err.join("\n") }
}

const ex = (f: string) => join("examples", "gesture", f)

test("README example: writes the C pair and the report, summary shows memory and accuracy", async () => {
  const out = join(work, "readme")
  const r = await cli(ex("model.json"), "--calib", ex("calib.json"), "--test", ex("test.json"), "--out", out, "--name", "gesture")
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /^4 -> 16 -> 8 -> 3 \(softmax\), asymmetric activations/)
  assert.match(r.out, /flash 459 bytes \(const data\), RAM 32 bytes \(scratch\) \+ 7 bytes/)
  assert.match(r.out, /argmax agreement 100\.0% \(150\/150\)/)
  assert.match(r.out, /label accuracy: float 100\.0%, int8 100\.0%/)
  for (const f of ["gesture.h", "gesture.c", "gesture.report.json"]) assert.ok(existsSync(join(out, f)), f)
  const report = JSON.parse(readFileSync(join(out, "gesture.report.json"), "utf8"))
  assert.equal(report.scheme, "asymmetric")
  assert.equal(report.layers.length, 3)
  assert.equal(report.memory.flashBytes, 459)
  assert.equal(report.accuracy.samples, 150)
})

test("--symmetric and --json", async () => {
  const r = await cli(ex("model.json"), "--calib", ex("calib.json"), "--out", join(work, "sym"), "--symmetric", "--json")
  assert.equal(r.code, 0, r.err)
  const report = JSON.parse(r.out)
  assert.equal(report.scheme, "symmetric")
  assert.equal(report.input.zeroPoint, 0)
  assert.ok(existsSync(join(work, "sym", "model.c")))
})

test("usage errors exit 2, bad files exit 1 with the reason", async () => {
  assert.equal((await cli()).code, 2)
  assert.equal((await cli(ex("model.json"), "--out", work)).code, 2)
  assert.equal((await cli(ex("model.json"), "--calib", ex("calib.json"), "--out", work, "--bogus")).code, 2)
  const help = await cli("--help")
  assert.equal(help.code, 0)
  assert.match(help.out, /Usage:/)

  const missing = await cli(join(work, "nope.json"), "--calib", ex("calib.json"), "--out", work)
  assert.equal(missing.code, 1)
  assert.match(missing.err, /cannot read model file .*ENOENT/)

  const broken = join(work, "broken.json")
  writeFileSync(broken, "{ layers: ")
  const bad = await cli(broken, "--calib", ex("calib.json"), "--out", work)
  assert.equal(bad.code, 1)
  assert.match(bad.err, /model file .* is not valid JSON/)

  const shape = join(work, "shape.json")
  writeFileSync(shape, JSON.stringify([[1, 2]]))
  const wrong = await cli(ex("model.json"), "--calib", shape, "--out", work)
  assert.equal(wrong.code, 1)
  assert.match(wrong.err, /calibration\.inputs\[0\] has 2 values, expected 4/)

  const name = await cli(ex("model.json"), "--calib", ex("calib.json"), "--out", work, "--name", "Bad-Name")
  assert.equal(name.code, 1)
  assert.match(name.err, /C identifier/)
})
