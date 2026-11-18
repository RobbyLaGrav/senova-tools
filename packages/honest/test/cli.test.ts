// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// The CLI's exit codes and output formats, which CI relies on.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { fileURLToPath } from "node:url"

import { EXIT, run } from "../src/index.ts"

let dir = ""
before(() => {
  dir = mkdtempSync(join(tmpdir(), "honest-cli-"))
  writeFileSync(join(dir, "clean.md"), "We cut the error to 0.21 mm from 0.34 mm in simulation.\n")
  writeFileSync(join(dir, "bad.md"), "A breakthrough, on a 1,000-unit run.\n")
  writeFileSync(join(dir, "warn.md"), "It is proven. <!-- just text -->\n")
})
after(() => rmSync(dir, { recursive: true, force: true }))

function cli(args: string[], stdin?: string) {
  let out = ""
  let err = ""
  const io = { stdout: (t: string) => void (out += t), stderr: (t: string) => void (err += t), cwd: dir, ...(stdin === undefined ? {} : { stdin: () => stdin }) }
  const code = run(args, io)
  return { code, out, err }
}

test("exit 0 and a summary when clean", () => {
  const r = cli(["check", "clean.md"])
  assert.equal(r.code, EXIT.ok)
  assert.match(r.out, /No findings in 1 file\./)
})

test("exit 1 with file:line:col, rule and hint when an error is found", () => {
  const r = cli(["check", "bad.md"])
  assert.equal(r.code, EXIT.findings)
  assert.match(r.out, /^bad\.md:1:3 {2}error {2}hype {2}"breakthrough" is a hype word/m)
  assert.match(r.out, /1 error and 0 warnings in 1 file\./)
})

test("warnings pass unless --max-warnings is exceeded; --quiet hides them", () => {
  writeFileSync(join(dir, "honest.config.json"), JSON.stringify({ rules: { hype: "warn" } }))
  try {
    assert.equal(cli(["check", "warn.md"]).code, EXIT.ok)
    const strict = cli(["check", "warn.md", "--max-warnings", "0"])
    assert.equal(strict.code, EXIT.findings)
    assert.match(strict.err, /more than --max-warnings 0/)
    assert.match(cli(["check", "warn.md", "-q"]).out, /No findings/)
  } finally {
    rmSync(join(dir, "honest.config.json"))
  }
})

test("--config picks a config file; bad config exits 2 with the reason", () => {
  writeFileSync(join(dir, "off.json"), JSON.stringify({ rules: { hype: "off" } }))
  writeFileSync(join(dir, "typo.json"), JSON.stringify({ rules: { hpye: "off" } }))
  assert.equal(cli(["check", "bad.md", "--config", "off.json"]).code, EXIT.ok)
  const r = cli(["check", "bad.md", "-c", "typo.json"])
  assert.equal(r.code, EXIT.usage)
  assert.match(r.err, /Unknown rule "hpye"/)
})

test("json and github formats", () => {
  const json = JSON.parse(cli(["check", "bad.md", "--format", "json"]).out)
  assert.equal(json.errors, 1)
  assert.equal(json.files, 1)
  assert.equal(json.findings[0].rule, "hype")
  const gh = cli(["check", "bad.md", "-f", "github"]).out
  assert.match(gh, /^::error file=bad\.md,line=1,col=3,title=honest\/hype::"breakthrough" is a hype word/m)
})

test("stdin with '-'", () => {
  const r = cli(["check", "-"], "Unprecedented.")
  assert.equal(r.code, EXIT.findings)
  assert.match(r.out, /^<stdin>:1:1/m)
})

test("usage errors exit 2: no command, unknown command, bad flag, bad format, missing path", () => {
  assert.equal(cli([]).code, EXIT.usage)
  assert.equal(cli(["lint"]).code, EXIT.usage)
  assert.equal(cli(["check", "--nope"]).code, EXIT.usage)
  assert.equal(cli(["check", "-f", "xml"]).code, EXIT.usage)
  assert.equal(cli(["check", "--max-warnings", "-1"]).code, EXIT.usage)
  const missing = cli(["check", "nowhere.md"])
  assert.equal(missing.code, EXIT.usage)
  assert.match(missing.err, /no such file or folder/)
})

test("help, version and the rules list", () => {
  assert.equal(cli(["--help"]).code, EXIT.ok)
  assert.match(cli(["-v"]).out, /^\d+\.\d+\.\d+\n$/)
  const rules = cli(["rules"]).out
  for (const id of ["hype", "hardware-claim", "simulation-note", "price", "vendor-figure", "insecure-source"]) assert.match(rules, new RegExp(`^${id}\\b`, "m"))
  assert.match(rules, /^simulation-note +off/m)
})

test("the bin entry point sets the process exit code", () => {
  const bin = fileURLToPath(new URL("../src/bin.ts", import.meta.url))
  const r = spawnSync(process.execPath, [bin, "check", "bad.md"], { cwd: dir, encoding: "utf8" })
  assert.equal(r.status, 1)
  assert.match(r.stdout, /hype/)
})
