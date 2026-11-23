// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
import assert from "node:assert/strict"
import { test } from "node:test"

import { cell, compareRuns, fence, parseRun, stringifyRun, toJunit, toMarkdown, type BenchRun, type TestResult } from "../src/index.ts"

function makeRun(value: number, over: Partial<BenchRun> = {}, extra: TestResult[] = []): BenchRun {
  const ok = value >= 3.2 && value <= 3.4
  return {
    version: 1,
    board: "devkit-1",
    image: "fw.bin",
    meta: { commit: "a1b2c3d4e5f6a7b8" },
    startedAt: "2026-11-22T10:00:00.000Z",
    durationMs: 1400,
    passed: ok && extra.every((t) => t.status === "pass"),
    tests: [
      { name: "boots", status: "pass", durationMs: 30, measurements: [], notes: [], consoleTail: [] },
      {
        name: "3v3 rail",
        status: ok ? "pass" : "fail",
        durationMs: 40,
        measurements: [{ name: "3v3", value, unit: "V", min: 3.2, max: 3.4, ok }],
        notes: [],
        consoleTail: ok ? [] : ["boot fw ok", `rail 3v3 ${value}`],
        ...(ok ? {} : { message: `3v3 = ${value} V, outside 3.2..3.4 V` }),
      },
      ...extra,
    ],
    ...over,
  }
}

test("compareRuns marks new, same, changed and out-of-limits", () => {
  assert.equal(compareRuns(makeRun(3.3))[0]?.status, "new")
  assert.deepEqual(compareRuns(makeRun(3.31), makeRun(3.3)).map((d) => [d.status, d.baseline]), [["same", 3.3]])
  const changed = compareRuns(makeRun(3.39), makeRun(3.3))[0]
  assert.equal(changed?.status, "changed")
  assert.ok(Math.abs((changed?.delta ?? 0) - 0.09) < 1e-9)
  assert.equal(compareRuns(makeRun(3.39), makeRun(3.3), { tolerance: 0.05 })[0]?.status, "same")
  assert.equal(compareRuns(makeRun(3.0), makeRun(3.3))[0]?.status, "out-of-limits")
})

test("the Markdown report: summary, tests, measurements with the base branch, and failure details", () => {
  const md = toMarkdown(makeRun(3.05), { baseline: makeRun(3.3) })
  assert.match(md, /^### Bench on devkit-1: FAILED\n\n1\/2 passed in 1\.4 s, commit a1b2c3d4e5f6, image fw\.bin\./)
  assert.match(md, /\| 3v3 rail \| FAIL \| 40 ms \|/)
  assert.match(md, /\| 3v3 rail \| 3v3 \| 3\.05 V \| 3\.2 to 3\.4 V \| 3\.3 V \| -0\.25 \(-7\.6%\) \| \*\*out of limits\*\* \|/)
  assert.match(md, /<details><summary>3v3 rail: FAIL<\/summary>/)
  assert.match(md, /Last 2 console lines:\n\n```\nboot fw ok\nrail 3v3 3\.05\n```/)
  assert.doesNotMatch(md, /mermaid/, "no charts without history")
})

test("trend charts are Mermaid xychart blocks over history plus this run", () => {
  const history = [3.29, 3.3, 3.31].map((v, i) => makeRun(v, { meta: { commit: `c${i}aaaaaaa` }, startedAt: `2026-11-2${i}T10:00:00.000Z` }))
  const md = toMarkdown(makeRun(3.32), { history })
  assert.match(md, /#### Trend over the last 4 runs/)
  assert.match(md, /```mermaid\nxychart-beta\n  title "3v3 rail: 3v3 \(V\)"\n  x-axis \["c0aaaaa", "c1aaaaa", "c2aaaaa", "a1b2c3d"\]\n  y-axis "V" \S+ --> \S+\n  line \[3\.29, 3\.3, 3\.31, 3\.32\]\n```/)
})

test("device output can't break the report or the XML", () => {
  const nasty = "x | y ``` `` <script>alert(1)</script> \u0007 & \"q\""
  const run = makeRun(3.3, { board: "devkit-1" }, [
    { name: "evil | name <b>", status: "error", durationMs: 1, message: nasty, measurements: [], notes: ["n <1>"], consoleTail: [nasty, "````"] },
  ])
  const md = toMarkdown(run)
  assert.match(md, /\| evil \\\| name \\<b\\> \| ERROR \|/)
  // The console fence is longer than the longest backtick run inside (4), so it can't be closed early.
  assert.match(md, /`````\nx \| y ``` `` <script>/)
  const junit = toJunit(run)
  assert.doesNotMatch(junit, /<script>|\u0007/)
  assert.match(junit, /&lt;script&gt;alert\(1\)&lt;\/script&gt; � &amp; &quot;q&quot;/)
  assert.match(junit, /<testcase classname="devkit-1" name="evil \| name &lt;b&gt;"/)
  assert.match(junit, /<error type="error" message=/)
  assert.match(junit, /<system-out>n &lt;1&gt;<\/system-out>/)
})

test("JUnit counts failures, errors and skips and carries measurements as properties", () => {
  const run = makeRun(3.0, {}, [
    { name: "slow", status: "timeout", durationMs: 5000, message: "timed out after 5000 ms", measurements: [], notes: [], consoleTail: [] },
    { name: "later", status: "skip", durationMs: 0, message: "run aborted", measurements: [], notes: [], consoleTail: [] },
  ])
  const x = toJunit(run)
  assert.match(x, /<testsuites name="bench" tests="4" failures="1" errors="1" time="1\.400">/)
  assert.match(x, /skipped="1"/)
  assert.match(x, /<property name="3v3" value="3 V"\/>/)
  assert.match(x, /<skipped message="run aborted"\/>/)
})

test("cell and fence helpers", () => {
  assert.equal(cell("a|b\nc"), "a\\|b c")
  assert.equal(fence("plain"), "```\nplain\n```")
  assert.equal(fence("has ``` inside", "txt"), "````txt\nhas ``` inside\n````")
})

test("results round-trip through JSON, NaN included, and bad files are named precisely", () => {
  const run = makeRun(3.3)
  run.tests[0]?.measurements.push({ name: "adc", value: Number.NaN, ok: false })
  const back = parseRun(stringifyRun(run))
  assert.ok(Number.isNaN(back.tests[0]?.measurements[0]?.value))
  assert.deepEqual({ ...back, tests: back.tests.slice(1) }, { ...run, tests: run.tests.slice(1) })

  assert.throws(() => parseRun("{nope"), { code: "BAD_RESULTS" })
  assert.throws(() => parseRun({ ...run, version: 2 }), /version 2 is not supported/)
  assert.throws(() => parseRun({ ...run, tests: [{ ...run.tests[1], status: "great" }] }), /tests\[0\]: status must be one of/)
  assert.throws(() => parseRun({ ...run, tests: [{ ...run.tests[1], measurements: [{ name: "x", value: "3.3", ok: true }] }] }), /tests\[0\]\.measurements\[0\]: value must be a number/)
  assert.throws(() => parseRun({ ...run, meta: { commit: 5 } }), /meta must be an object of strings/)
})
