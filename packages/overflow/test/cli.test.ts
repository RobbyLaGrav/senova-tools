// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// The README's two-minute example through the CLI, the formatters, exit codes and bad input.
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, describe, test } from "node:test"
import { fileURLToPath } from "node:url"

import { main, type CliIo } from "../src/cli.ts"
import { check, formatMarkdown, formatText, type Report } from "../src/index.ts"
import { Page } from "./build.ts"

const examples = fileURLToPath(new URL("../examples/", import.meta.url))
const tmp = mkdtempSync(join(tmpdir(), "overflow-cli-"))
after(() => rmSync(tmp, { recursive: true, force: true }))

function run(...argv: string[]): { code: number; out: string; err: string } {
  let out = ""
  let err = ""
  const io: CliIo = { stdout: (t) => (out += t + "\n"), stderr: (t) => (err += t + "\n"), cwd: examples }
  const code = main(argv, io)
  return { code, out, err }
}

const write = (name: string, text: string) => {
  const p = join(tmp, name)
  writeFileSync(p, text)
  return p
}

describe("README example", () => {
  test("text output and exit code 1", () => {
    const r = run("check", "sample-snapshot.json", "--config", "overflow.config.json")
    assert.equal(r.code, 1)
    assert.equal(r.err, "")
    assert.match(r.out, /^http:\/\/127\.0\.0\.1:3000\/ at 375x812 \(mobile\): 2 errors, 4 warnings, 2 info in 20 elements\n/)
    const heads = r.out.split("\n").filter((l) => /^(ERROR|WARNING|INFO)/.test(l)).map((l) => l.replace(/\s+/g, " "))
    assert.deepEqual(heads, [
      "ERROR page-overflow-x html",
      "ERROR page-overflow-x html > body > table.usage",
      "WARNING title-wraps html > body > h1.hero-title",
      "WARNING inner-scrollbar html > body > nav.sidebar",
      "WARNING column-misaligned html > body > ul.team > li:nth-of-type(2) > span.role",
      "WARNING text-clipped html > body > div.card > p.card-body",
      "INFO title-widow html > body > h1.hero-title",
      "INFO text-clipped html > body > div.card > h3.card-title",
    ])
    assert.ok(!r.out.includes(" pre"), "the code block is in allowScroll")
  })

  test("without the config the code block is reported too", () => {
    const r = run("check", "sample-snapshot.json", "--format", "json")
    const report = JSON.parse(r.out) as Report
    assert.ok(report.findings.some((f) => f.rule === "inner-scrollbar" && f.selector === "html > body > pre"))
  })

  test("--fail-on error still fails (two errors); never always passes", () => {
    assert.equal(run("check", "sample-snapshot.json", "-c", "overflow.config.json", "--fail-on", "error").code, 1)
    assert.equal(run("check", "sample-snapshot.json", "--fail-on", "never").code, 0)
  })

  test("json and markdown formats", () => {
    const j = run("check", "sample-snapshot.json", "-c", "overflow.config.json", "-f", "json", "--label", "phone")
    const report = JSON.parse(j.out) as Report
    assert.deepEqual(report.counts, { error: 2, warning: 4, info: 2 })
    assert.equal(report.viewport.label, "phone")
    const m = run("check", "sample-snapshot.json", "-c", "overflow.config.json", "-f", "markdown")
    assert.match(m.out, /^### Overflow: http:\/\/127\.0\.0\.1:3000\/ at 375x812 \(mobile\)/)
    assert.match(m.out, /\| error \| page-overflow-x \| `html > body > table.usage` \|/)
  })
})

describe("cli", () => {
  test("a clean snapshot exits 0; several files give an array in json", () => {
    const clean = write("clean.json", JSON.stringify(new Page().snap))
    const r = run("check", clean)
    assert.equal(r.code, 0)
    assert.match(r.out, /no findings in 2 elements/)
    const both = run("check", clean, "sample-snapshot.json", "-f", "json")
    const reports = JSON.parse(both.out) as Report[]
    assert.equal(reports.length, 2)
    assert.equal(both.code, 1)
  })

  test("failOn in the config is used unless --fail-on overrides it", () => {
    const cfg = write("info.json", '{"failOn":"info","rules":{"page-overflow-x":"off","inner-scrollbar":"off","column-misaligned":"off","title-wraps":"off","text-clipped":"off"}}')
    assert.equal(run("check", "sample-snapshot.json", "-c", cfg).code, 1, "title-widow is info")
    assert.equal(run("check", "sample-snapshot.json", "-c", cfg, "--fail-on", "warning").code, 0)
  })

  test("bad input exits 2 with the file and field named", () => {
    const bad = write("bad.json", JSON.stringify({ ...new Page().snap, viewport: { width: "wide", height: 1 } }))
    let r = run("check", bad)
    assert.equal(r.code, 2)
    assert.match(r.err, /bad\.json: viewport\.width: must be a finite number/)
    r = run("check", write("notjson.json", "<html>"))
    assert.equal(r.code, 2)
    assert.match(r.err, /not valid JSON/)
    r = run("check", "missing.json")
    assert.equal(r.code, 2)
    assert.match(r.err, /missing\.json: cannot read snapshot .*no such file/)
    r = run("check", "sample-snapshot.json", "-c", write("cfg.json", '{"tolerence":{}}'))
    assert.equal(r.code, 2)
    assert.match(r.err, /config .*cfg\.json: tolerence: is not a config field/)
    assert.equal(run("check", write("bom.json", "﻿" + JSON.stringify(new Page().snap))).code, 0, "a UTF-8 BOM is accepted")
  })

  test("usage mistakes exit 2; help exits 0", () => {
    assert.equal(run().code, 2)
    assert.equal(run("--help").code, 0)
    assert.match(run("help").out, /overflow check <snapshot\.json\.\.\.>/)
    assert.equal(run("lint").code, 2)
    assert.equal(run("check").code, 2)
    assert.match(run("check", "sample-snapshot.json", "-f", "html").err, /--format must be text, markdown or json/)
    assert.match(run("check", "sample-snapshot.json", "--fail-on", "fatal").err, /--fail-on must be/)
    assert.equal(run("check", "--nope").code, 2)
    assert.equal(run("collector", "x.json").code, 2)
  })

  test("collector prints an expression or a bookmarklet", () => {
    const e = run("collector", "--label", "mobile")
    assert.equal(e.code, 0)
    assert.match(e.out, /^\(function collectLayout\(/)
    assert.match(e.out, /\(\{"label":"mobile"\}\)\n$/)
    assert.match(run("collector", "--bookmarklet").out, /^javascript:/)
  })
})

describe("formatters", () => {
  test("Markdown escapes pipes, backticks and newlines", () => {
    const p = new Page()
    p.add(1, "div", [0, 0, 100, 20], { selector: "div[data-x='a|b`c']", overflowX: "hidden", scrollWidth: 300, text: "a | b\nc" })
    const md = formatMarkdown(check(p.snap))
    const row = md.split("\n").find((l) => l.startsWith("| warning"))!
    assert.equal(row, "| warning | text-clipped | `` div[data-x='a\\|b`c'] `` | text is clipped: 200 px cut off on the right: \"a \\| b c\" |")
  })

  test("text and Markdown say when the snapshot was truncated, and when it is clean", () => {
    const p = new Page()
    p.snap.truncated = true
    const r = check(p.snap)
    assert.match(formatText(r), /no findings in 2 elements\nnote: the collector stopped at its element limit/)
    assert.match(formatMarkdown(r), /no findings in 2 elements\.\n\nNote: the collector stopped/)
    assert.ok(!formatMarkdown(r).includes("| Severity"))
  })

  test("the README's sample report matches the file in examples/", () => {
    const text = run("check", "sample-snapshot.json", "-c", "overflow.config.json").out
    assert.equal(text, readFileSync(join(examples, "sample-report.txt"), "utf8").replace(/\r\n/g, "\n"))
  })
})
