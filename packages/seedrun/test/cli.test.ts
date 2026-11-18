// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Runs the README's two-minute example through the CLI, including the side-by-side mode (child processes).
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"
import { fileURLToPath } from "node:url"

import { main, type CliIo } from "../src/cli.ts"
import { sha256 } from "../src/index.ts"

const example = fileURLToPath(new URL("../examples/monte-carlo/", import.meta.url))
const work = mkdtempSync(join(tmpdir(), "seedrun-cli-"))
after(() => rmSync(work, { recursive: true, force: true }))

// The example's merged results file, pinned. If this changes, results people already published would stop matching.
const EXAMPLE_SHA256 = "364f7602388a482b5ff708bda7f49fa4efb075ca372cf883ff63739b65dbb63d"

async function cli(...args: string[]) {
  const out: string[] = []
  const err: string[] = []
  const io: CliIo = { stdout: (l) => out.push(l), stderr: (l) => err.push(l), cwd: example }
  const code = await main(args, io)
  return { code, out: out.join("\n"), err: err.join("\n") }
}

const paths = (dir: string) => ["--out", join(work, dir, "out"), "--results", join(work, dir, "results.json")]

test("run every part side by side, then merge: the pinned bytes come out", async () => {
  const run = await cli("run", "--all", "--jobs", "2", ...paths("parallel"))
  assert.equal(run.code, 0, run.err)
  assert.match(run.err, /2 side by side/)
  assert.match(run.out, /pi: wrote/)
  assert.match(run.out, /walks: wrote/)
  const merge = await cli("merge", ...paths("parallel"))
  assert.equal(merge.code, 0, merge.err)
  assert.equal(sha256(readFileSync(join(work, "parallel", "results.json"), "utf8")), EXAMPLE_SHA256)
})

test("running the parts one after another in one process gives the same bytes", async () => {
  assert.equal((await cli("run", "walks", "pi", "--jobs", "1", ...paths("serial"))).code, 0)
  assert.equal((await cli("merge", ...paths("serial"))).code, 0)
  assert.equal(sha256(readFileSync(join(work, "serial", "results.json"), "utf8")), EXAMPLE_SHA256)
})

test("verify runs a part twice and compares with the saved file", async () => {
  await cli("run", "pi", "--jobs", "1", ...paths("verify"))
  const v = await cli("verify", "--all", ...paths("verify"))
  assert.equal(v.code, 0, v.out)
  assert.match(v.out, /pi: same bytes twice, and same as/)
  assert.match(v.out, /walks: same bytes twice .*no saved file/)
})

test("list shows parts and seeds", async () => {
  const l = await cli("list", ...paths("list"))
  assert.equal(l.code, 0)
  assert.match(l.out, /monte-carlo {2}seed 2026/)
  assert.match(l.out, /pi +seed 3744696576/)
})

test("usage mistakes exit 2 with help; failures exit 1", async () => {
  assert.equal((await cli()).code, 2)
  assert.equal((await cli("--help")).code, 0)
  assert.equal((await cli("run", ...paths("bad"))).code, 2)
  assert.match((await cli("run", "nope", ...paths("bad"))).err, /no part "nope"/)
  assert.equal((await cli("run", "pi", "--jobs", "0", ...paths("bad"))).code, 2)
  assert.equal((await cli("frobnicate", ...paths("bad"))).code, 2)
  const m = await cli("merge", ...paths("bad"))
  assert.equal(m.code, 1)
  assert.match(m.err, /missing results/)
  assert.match((await cli("list", "--config", "missing.ts")).err, /config file not found/)
})
