// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Runs the README's two-minute example through the CLI, plus exit codes and argument errors.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { fileURLToPath } from "node:url"

import { main, type CliIo } from "../src/cli.ts"
import type { Manifest } from "../src/index.ts"
import { writeExampleRenders } from "../examples/two-minute.ts"

const work = mkdtempSync(join(tmpdir(), "renderpack-cli-"))
after(() => rmSync(work, { recursive: true, force: true }))
before(() => writeExampleRenders(join(work, "renders")))

async function cli(...args: string[]) {
  const out: string[] = []
  const err: string[] = []
  const io: CliIo = { stdout: (l) => out.push(l), stderr: (l) => err.push(l), cwd: work }
  const code = await main(args, io)
  return { code, out: out.join("\n"), err: err.join("\n") }
}

test("README example: renderpack renders/ web/ builds, warns and fails the broken file", async () => {
  const r = await cli("renders", "web", "--widths", "480,960,1920", "--aspect", "4:3")
  assert.equal(r.code, 1, "one input is broken")
  assert.match(r.out, /4 built, 0 unchanged, 1 failed, \d+ warning\(s\)\. Manifest web[\\/]manifest\.json, contact sheet web[\\/]contact-sheet\.html/)
  assert.match(r.out, /bracket-back\.png: error: not a PNG file/)
  assert.match(r.out, /bracket-front-copy\.png: warning \[near-duplicate\] looks like bracket-front\.png/)
  assert.match(r.out, /bracket-side\.png: warning \[mostly-empty\]/)
  assert.match(r.out, /bracket-side\.png: warning \[too-small\]/)
  assert.match(r.out, /Bracket Top_FINAL\.png: warning \[naming\]/)
  assert.match(r.out, /Bracket Top_FINAL\.png: warning \[background-mismatch\] the render's background is #eeeeee/)
  assert.match(r.err, /bracket-front\.png: 480, 960 px/)
  const m = JSON.parse(readFileSync(join(work, "web", "manifest.json"), "utf8")) as Manifest
  assert.equal(m.images.length, 4)
  assert.deepEqual(m.options.widths, [480, 960, 1920])

  const again = await cli("renders", "web", "--widths", "480,960,1920", "--aspect", "4:3", "--quiet")
  assert.equal(again.out, again.out.split("\n")[0], "quiet prints one line")
  assert.match(again.out, /^0 built, 4 unchanged, 1 failed/)
})

test("--strict turns warnings into exit code 1; a clean run exits 0", async () => {
  const one = join(work, "renders", "bracket-front.png")
  const clean = await cli(one, "clean", "--widths", "480", "--sheet", "none")
  assert.equal(clean.code, 0, clean.err)
  assert.match(clean.out, /1 built, 0 unchanged, 0 failed, 0 warning\(s\)\. Manifest clean[\\/]manifest\.json$/)
  assert.equal(existsSync(join(work, "clean", "contact-sheet.html")), false)
  const strict = await cli(join(work, "renders", "bracket-side.png"), "strict", "--strict")
  assert.equal(strict.code, 1)
  const options = await cli(one, "opts", "-w", "300", "-a", "none", "-b", "#000", "--no-trim", "--filter", "area", "--hash-names", "--sheet", "inline", "--force")
  assert.equal(options.code, 0, options.err)
  const m = JSON.parse(readFileSync(join(work, "opts", "manifest.json"), "utf8")) as Manifest
  assert.equal(m.options.aspect, null)
  assert.equal(m.options.trim, false)
  assert.equal(m.options.background, "#000000")
  assert.equal(m.images[0]!.height, 1800)
  assert.match(m.images[0]!.src, /^bracket-front-300\.[0-9a-f]{8}\.png$/)
})

test("bad arguments exit 2 with the usage text", async () => {
  for (const args of [[], ["only-one"], ["a", "b", "c"], ["renders", "x", "--widths", "480,big"], ["renders", "x", "--sheet", "pdf"],
    ["renders", "x", "--filter", "nearest"], ["renders", "x", "--bogus"], ["renders", "x", "--margin", ""]]) {
    const r = await cli(...args)
    assert.equal(r.code, 2, args.join(" "))
    assert.match(r.err, /Usage:/)
  }
  for (const args of [["renders", "x", "--aspect", "wide"], ["renders", "x", "--background", "teal"], ["renders", "x", "--widths", "0"], ["renders", "renders"]]) {
    const r = await cli(...args)
    assert.ok(r.code === 2 || r.code === 1, args.join(" "))
    assert.match(r.err, /^renderpack: /)
  }
  assert.equal((await cli("missing-folder", "x")).code, 1)
  const help = await cli("--help")
  assert.equal(help.code, 0)
  assert.match(help.out, /renderpack <in> <out> \[options\]/)
})

test("the bin script runs as a real command", () => {
  const bin = fileURLToPath(new URL("../src/bin.ts", import.meta.url))
  const r = spawnSync(process.execPath, [bin, "--help"], { encoding: "utf8" })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /Exit codes/)
})
