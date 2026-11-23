// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// The `bench` command, called in-process with a config that uses a simulated board.
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { after, test } from "node:test"

import { main, parseRun, type CliIo } from "../src/index.ts"

const dir = mkdtempSync(join(tmpdir(), "bench-cli-"))
after(() => rmSync(dir, { recursive: true, force: true }))
const src = pathToFileURL(join(import.meta.dirname, "..", "src", "index.ts")).href

function config(name: string, railOffset = 0): string {
  const path = join(dir, `${name}.config.ts`)
  writeFileSync(
    path,
    `import { SimBoard } from ${JSON.stringify(src)}
export default {
  board: new SimBoard({ name: ${JSON.stringify(name)}, seed: 3, bootMs: 5, faults: { railOffset: { "3v3": ${railOffset} } } }),
  image: "fw.bin",
  tests: [{ name: "3v3 rail", run: async (t) => {
    await t.waitFor(/^boot /)
    await t.send("rail 3v3")
    const line = await t.waitFor(/^rail 3v3 /)
    t.measure("3v3", Number(line.split(" ")[2]), { unit: "V", min: 3.2, max: 3.4 })
  } }],
}
`,
  )
  return path
}

async function cli(args: string[], env: Record<string, string> = {}) {
  const out: string[] = []
  const err: string[] = []
  const io: CliIo = { stdout: (l) => out.push(l), stderr: (l) => err.push(l), cwd: dir, env }
  const exit = await main(args, io)
  return { exit, out: out.join("\n"), err: err.join("\n") }
}

test("help and usage errors", async () => {
  assert.equal((await cli(["--help"])).exit, 0)
  assert.equal((await cli([])).exit, 2)
  assert.match((await cli(["frobnicate"])).err, /unknown command "frobnicate"/)
  assert.equal((await cli(["run"])).exit, 2)
  assert.equal((await cli(["report", "a.json", "b.json"])).exit, 2)
  assert.equal((await cli(["run", "x.ts", "--bogus"])).exit, 2)
})

test("run writes results, JUnit and the report, with commit and branch from the CI environment", async () => {
  const r = await cli(["run", config("good"), "--out", "out-good", "--lock-dir", dir], { GITHUB_SHA: "0123456789abcdef", GITHUB_HEAD_REF: "feat/adc" })
  assert.equal(r.exit, 0, r.err)
  assert.match(r.out, /^pass +3v3 rail$/m)
  const run = parseRun(readFileSync(join(dir, "out-good", "bench-results.json"), "utf8"))
  assert.deepEqual(run.meta, { commit: "0123456789abcdef", branch: "feat/adc" })
  assert.equal(run.image, "fw.bin")
  assert.match(readFileSync(join(dir, "out-good", "junit.xml"), "utf8"), /<testcase classname="good" name="3v3 rail"/)
  assert.match(readFileSync(join(dir, "out-good", "bench-report.md"), "utf8"), /^### Bench on good: passed/)
  assert.ok(!existsSync(join(dir, "bench-good.lock")), "lock released")
})

test("a failing run exits 1 and compares against the baseline and history", async () => {
  mkdirSync(join(dir, "history"), { recursive: true })
  writeFileSync(join(dir, "history", "a.json"), readFileSync(join(dir, "out-good", "bench-results.json")))
  writeFileSync(join(dir, "history", "junk.json"), "{}")
  const r = await cli(["run", config("bad", -0.3), "--out", "out-bad", "--lock-dir", dir, "--baseline", "out-good/bench-results.json", "--history", "history"])
  assert.equal(r.exit, 1)
  assert.match(r.out, /^fail +3v3 rail: 3v3 = 3\.0\d+ V, outside 3\.2\.\.3\.4 V$/m)
  assert.match(r.err, /skipping history file: .*junk\.json: run: version undefined is not supported/)
  const md = readFileSync(join(dir, "out-bad", "bench-report.md"), "utf8")
  assert.match(md, /\*\*out of limits\*\*/)
  assert.match(md, /```mermaid\nxychart-beta/)
})

test("report rebuilds the files from saved results", async () => {
  const r = await cli(["report", "out-bad/bench-results.json", "--out", "out-report", "--baseline", "out-good/bench-results.json"])
  assert.equal(r.exit, 1)
  assert.match(readFileSync(join(dir, "out-report", "bench-report.md"), "utf8"), /\| Base \| Change \|/)
  assert.ok(!existsSync(join(dir, "out-report", "bench-results.json")))
  const missing = await cli(["report", "nope.json"])
  assert.equal(missing.exit, 2)
  assert.match(missing.err, /cannot read .*nope\.json/)
})

test("a board in use exits 2 without running; a bad config is named", async () => {
  writeFileSync(join(dir, "bench-busy.lock"), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }))
  const busy = await cli(["run", config("busy"), "--lock-dir", dir, "--out", "out-busy"])
  assert.equal(busy.exit, 2)
  assert.match(busy.err, /board busy is in use by pid/)
  assert.ok(!existsSync(join(dir, "out-busy")))

  writeFileSync(join(dir, "empty.config.ts"), "export default { nothing: true }\n")
  const bad = await cli(["run", "empty.config.ts", "--lock-dir", dir])
  assert.equal(bad.exit, 2)
  assert.match(bad.err, /must have a default export of \{ board, tests \}/)
  assert.equal((await cli(["run", config("w"), "--lock-wait", "soon"])).exit, 2)
})
