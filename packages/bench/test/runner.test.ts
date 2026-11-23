// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
import assert from "node:assert/strict"
import { after, test } from "node:test"

import { runBench, SimBoard, type BenchEvent, type BenchTest, type SimBoardOptions, type TestContext } from "../src/index.ts"

const boards: SimBoard[] = []
after(async () => {
  for (const b of boards) await b.close()
})
const sim = (o: SimBoardOptions = {}) => {
  const b = new SimBoard({ name: "devkit-1", seed: 42, bootMs: 5, rails: { "3v3": 3.3 }, ...o })
  boards.push(b)
  return b
}
const booted = /^boot \S+ ok$/

const railTest: BenchTest = {
  name: "3v3 rail",
  run: async (t) => {
    await t.waitFor(booted)
    await t.send("rail 3v3")
    const line = await t.waitFor(/^rail 3v3 \S+$/)
    t.measure("3v3", Number(line.split(" ")[2]), { unit: "V", min: 3.2, max: 3.4 })
  },
}

test("the README example passes on a healthy board", async () => {
  const board = sim()
  const events: BenchEvent["type"][] = []
  const run = await runBench({
    board,
    image: "build/firmware.bin",
    tests: [
      { name: "boots", run: async (t) => void (await t.waitFor(booted)) },
      {
        name: "console answers",
        run: async (t) => {
          await t.waitFor(booted)
          await t.send("ping")
          await t.waitFor("pong", { timeoutMs: 500 })
        },
      },
      railTest,
    ],
    meta: { commit: "a1b2c3d" },
    onEvent: (e) => events.push(e.type),
  })
  assert.equal(run.passed, true)
  assert.equal(run.version, 1)
  assert.equal(run.board, "devkit-1")
  assert.equal(run.image, "build/firmware.bin")
  assert.deepEqual(run.meta, { commit: "a1b2c3d" })
  assert.deepEqual(run.tests.map((t) => t.status), ["pass", "pass", "pass"])
  const m = run.tests[2]?.measurements[0]
  assert.ok(m && m.ok && Math.abs(m.value - 3.3) <= 0.005 && m.unit === "V")
  assert.deepEqual(run.tests[0]?.consoleTail, [])
  // Flash once, then a reset before each later test.
  assert.deepEqual(board.history, ["flash build/firmware.bin", "reset", "reset"])
  assert.deepEqual(events, ["flash", "test-start", "test-end", "test-start", "test-end", "test-start", "measurement", "test-end"])
})

test("a reading outside its limits fails the test, is kept, and the console tail comes with it", async () => {
  const run = await runBench({ board: sim({ faults: { railOffset: { "3v3": -0.25 } } }), image: "fw.bin", tests: [railTest] })
  const t = run.tests[0]
  assert.equal(run.passed, false)
  assert.equal(t?.status, "fail")
  assert.match(t?.message ?? "", /^3v3 = 3\.0\d+ V, outside 3\.2\.\.3\.4 V$/)
  assert.equal(t?.measurements[0]?.ok, false)
  assert.deepEqual(t?.consoleTail[0], "boot fw.bin ok")
  assert.match(t?.consoleTail[1] ?? "", /^rail 3v3 3\.0/)
})

test("check(), non-finite readings and notes", async () => {
  const run = await runBench({
    board: sim(),
    tests: [
      {
        name: "mixed",
        run: (t) => {
          t.log("starting")
          t.check(1 + 1 === 3, "arithmetic is broken")
          t.measure("adc", Number.NaN)
          t.measure("temp", 25, { max: 85 })
        },
      },
    ],
  })
  const t = run.tests[0]
  assert.equal(t?.status, "fail")
  assert.equal(t?.message, "arithmetic is broken; adc is not a number")
  assert.deepEqual(t?.notes, ["starting"])
  assert.deepEqual(t?.measurements.map((m) => m.ok), [false, true])
})

test("a thrown error is an error, a slow test times out and is aborted", async () => {
  let abortedSeen = false
  const run = await runBench({
    board: sim({ faults: { silent: true } }),
    tests: [
      { name: "throws", run: () => { throw new Error("boom") } },
      { name: "no answer", run: async (t) => { await t.send("ping"); await t.waitFor("pong", { timeoutMs: 30 }) } },
      {
        name: "hangs",
        timeoutMs: 40,
        run: (t) => new Promise<void>((resolve) => t.signal.addEventListener("abort", () => { abortedSeen = true; resolve() })),
      },
    ],
  })
  assert.deepEqual(run.tests.map((t) => t.status), ["error", "error", "timeout"])
  assert.equal(run.tests[0]?.message, "boom")
  assert.match(run.tests[1]?.message ?? "", /no console line matched "pong" within 30 ms/)
  assert.equal(run.tests[2]?.message, "timed out after 40 ms")
  assert.equal(abortedSeen, true)
})

test("waitFor moves past each match, so the same line isn't matched twice", async () => {
  const run = await runBench({
    board: sim(),
    tests: [
      {
        name: "two rails",
        run: async (t) => {
          await t.waitFor(booted)
          await t.send("rail 3v3")
          const first = await t.waitFor(/^rail /)
          await t.send("rail 3v3")
          const second = await t.waitFor(/^rail /)
          t.check(first !== second, "second wait returned the first reading")
        },
      },
    ],
  })
  assert.equal(run.tests[0]?.status, "pass", run.tests[0]?.message)
})

test("boot lines printed while flash or reset is still running are seen by the test", async () => {
  const console = new SimBoard().console
  let boots = 0
  const board = {
    name: "eager",
    console,
    flash: async () => console.push(`boot ${++boots} ok\n`),
    reset: async () => console.push(`boot ${++boots} ok\n`),
    send: async () => {},
    close: async () => {},
  }
  const seen: string[] = []
  const run = await runBench({
    board,
    image: "fw.bin",
    tests: ["first", "second"].map((name) => ({ name, run: async (t: TestContext) => void seen.push(await t.waitFor(/^boot \d ok$/, { timeoutMs: 100 })) })),
  })
  assert.equal(run.passed, true, JSON.stringify(run.tests))
  assert.deepEqual(seen, ["boot 1 ok", "boot 2 ok"])
})

test("a failed flash marks every test as an error and runs nothing", async () => {
  let ran = false
  const run = await runBench({ board: sim({ faults: { flashFails: true } }), image: "fw.bin", tests: [{ name: "a", run: () => { ran = true } }, { name: "b", run: () => {} }] })
  assert.equal(ran, false)
  assert.deepEqual(run.tests.map((t) => t.status), ["error", "error"])
  assert.match(run.tests[0]?.message ?? "", /^flash failed: devkit-1: flash failed \(simulated\)$/)
})

test("skip, abort and resetBetween: false", async () => {
  const board = sim()
  const stop = new AbortController()
  const run = await runBench({
    board,
    resetBetween: false,
    signal: stop.signal,
    tests: [
      { name: "skipped", skip: "no probe fitted", run: () => {} },
      { name: "first", run: () => stop.abort() },
      { name: "after abort", run: () => {} },
    ],
  })
  assert.deepEqual(run.tests.map((t) => [t.status, t.message]), [["skip", "no probe fitted"], ["pass", undefined], ["skip", "run aborted"]])
  assert.equal(run.passed, true)
  assert.deepEqual(board.history, ["reset"])
})

test("bad options are refused before anything runs", async () => {
  const board = sim()
  await assert.rejects(runBench({ board, tests: [{ name: "a", run: () => {} }, { name: "a", run: () => {} }] }), /two tests are named "a"/)
  await assert.rejects(runBench({ board, tests: [{ name: " ", run: () => {} }] }), { code: "INVALID_ARGUMENT" })
  await assert.rejects(runBench({ board, tests: [], timeoutMs: 0 }), { code: "INVALID_ARGUMENT" })
  await assert.rejects(runBench({ board: {} as SimBoard, tests: [] }), { code: "INVALID_ARGUMENT" })
  assert.deepEqual(board.history, [])
})

test("a broken onEvent callback doesn't change the results", async () => {
  const run = await runBench({ board: sim(), tests: [{ name: "a", run: () => {} }], onEvent: () => { throw new Error("ui crashed") } })
  assert.equal(run.passed, true)
})

test("SimBoard is deterministic for a seed and answers unknown commands", async () => {
  const read = async () => {
    const b = sim({ seed: 7 })
    await b.reset()
    await b.console.waitFor(booted)
    await b.send("rail 3v3")
    await b.send("frob")
    await b.send("version")
    const lines = [(await b.console.waitFor(/^rail /)).line, (await b.console.waitFor(/^err /)).line, (await b.console.waitFor(/^version /)).line]
    await b.close()
    return lines
  }
  const a = await read()
  assert.deepEqual(a, await read())
  assert.deepEqual(a.slice(1), ["err unknown", "version none"])
  await assert.rejects(sim().send("a\nb"), { code: "INVALID_ARGUMENT" })
  const closed = sim()
  await closed.close()
  await assert.rejects(closed.reset(), { code: "CLOSED" })
})
