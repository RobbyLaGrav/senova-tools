// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// The `diskguard` command, called in-process with a fake free-space reader where numbers matter.
import assert from "node:assert/strict"
import { existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { after, test } from "node:test"

import { main, type CliIo } from "../src/cli.ts"
import type { SpaceReader } from "../src/index.ts"
import { age, makeRepo, put, tempRoot } from "./fixture.ts"

const t = tempRoot("cli")
after(t.done)
const home = join(t.dir, "home")
const code = join(home, "code")
mkdirSync(code, { recursive: true })
const app = makeRepo(join(code, "app"))
put(join(app, ".next", "a.bin"), 4000)
put(join(app, "dist", "b.bin"), 1000)
age(app, 60)

const fakeRead = (free: number): SpaceReader => async (p) => ({ path: p, free, total: 100_000, freePercent: free / 1000 })

async function cli(args: string[], read?: SpaceReader) {
  const out: string[] = []
  const err: string[] = []
  const io: CliIo = { stdout: (l) => out.push(l), stderr: (l) => err.push(l), cwd: code, home, ...(read ? { read } : {}) }
  const exit = await main(args, io)
  return { exit, out: out.join("\n"), err: err.join("\n") }
}

test("help and usage errors", async () => {
  assert.equal((await cli(["--help"])).exit, 0)
  assert.equal((await cli([])).exit, 2)
  const unknown = await cli(["frobnicate"])
  assert.equal(unknown.exit, 2)
  assert.match(unknown.err, /unknown command "frobnicate"/)
  assert.equal((await cli(["status", "--bogus"])).exit, 2)
  assert.match((await cli(["status", "--yes"])).err, /--yes does not apply to "status"/)
  assert.match((await cli(["scan"])).err, /name the root folders/)
  assert.match((await cli(["clean", ".", "--target", "lots"])).err, /can't read size "lots"/)
  assert.match((await cli(["scan", ".", "--depth", "1.5"])).err, /--depth must be a whole number/)
  assert.match((await cli(["watch", "."])).err, /needs --warn/)
})

test("status grades each path and exits 1 below a threshold", async () => {
  const fine = await cli(["status", ".", "--warn", "10%"], fakeRead(50_000))
  assert.equal(fine.exit, 0)
  assert.match(fine.out, /^OK\s+\.\s+50\.0 kB free of 100 kB \(50\.0%\)/)
  const low = await cli(["status", "--warn", "10%", "--critical", "5KB", "--json"], fakeRead(4000))
  assert.equal(low.exit, 1)
  const j = JSON.parse(low.out)
  assert.equal(j.paths[0].level, "critical")
  assert.deepEqual(j.thresholds, { warn: "10%", critical: "5.00 kB" })
  assert.equal((await cli(["status"])).exit, 0, "real statfs on the temp folder, no thresholds")
})

test("scan lists the worktree and its caches", async () => {
  const r = await cli(["scan", "."])
  assert.equal(r.exit, 0, r.err)
  assert.match(r.out, /app\s+main/)
  assert.match(r.out, /4\.00 kB\s+\.next/)
  assert.match(r.out, /1 worktree\(s\), 2 cache folder\(s\), 5\.00 kB clearable/)
  const j = JSON.parse((await cli(["scan", ".", "--json"])).out)
  assert.equal(j.caches.length, 2)
})

test("clean is a dry run until --yes, and refuses the home folder", async () => {
  const dry = await cli(["clean", "."], fakeRead(1000))
  assert.equal(dry.exit, 0, dry.err)
  assert.match(dry.out, /would delete/)
  assert.match(dry.out, /Nothing was deleted; add --yes to delete/)
  assert.ok(existsSync(join(app, ".next")))

  const refused = await cli(["clean", home, "--yes"])
  assert.equal(refused.exit, 2)
  assert.match(refused.err, /home folder/)

  const real = await cli(["clean", ".", "--yes", "--target", "4500B", "--json"], fakeRead(1000))
  assert.equal(real.exit, 0, real.err)
  const j = JSON.parse(real.out)
  assert.equal(j.dryRun, false)
  assert.deepEqual(j.actions.map((a: { name: string; result: string }) => [a.name, a.result]), [[".next", "deleted"], ["dist", "deleted"]])
  assert.equal(existsSync(join(app, ".next")), false)
  assert.ok(existsSync(join(app, "src", "index.ts")))
})
