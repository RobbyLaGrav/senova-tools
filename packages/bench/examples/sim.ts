// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// The README example: flash a simulated board, check it boots, answers and holds its 3.3 V rail, then write the
// results file, JUnit XML and the pull-request report. No hardware needed.
// Run: node examples/sim.ts [out-dir=bench-out] [--fault]
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { runBench, SimBoard, stringifyRun, toJunit, toMarkdown, type BenchTest } from "../src/index.ts"

const args = process.argv.slice(2)
const fault = args.includes("--fault")
const out = args.find((a) => !a.startsWith("--")) ?? "bench-out"

const board = new SimBoard({
  name: "devkit-1",
  seed: 42,
  rails: { "3v3": 3.3, vbat: 3.95 },
  // --fault: the 3.3 V rail sags by 0.25 V, as with a failing regulator.
  ...(fault ? { faults: { railOffset: { "3v3": -0.25 } } } : {}),
})

const tests: BenchTest[] = [
  { name: "boots", run: async (t) => void (await t.waitFor(/^boot \S+ ok$/)) },
  {
    name: "console answers",
    run: async (t) => {
      await t.waitFor(/^boot \S+ ok$/)
      await t.send("ping")
      await t.waitFor("pong", { timeoutMs: 500 })
    },
  },
  {
    name: "3v3 rail",
    run: async (t) => {
      await t.waitFor(/^boot \S+ ok$/)
      await t.send("rail 3v3")
      const line = await t.waitFor(/^rail 3v3 \S+$/)
      t.measure("3v3", Number(line.split(" ")[2]), { unit: "V", min: 3.2, max: 3.4 })
    },
  },
]

const run = await runBench({ board, image: "build/firmware.bin", tests, meta: { commit: "a1b2c3d", branch: "feat/adc" } })
await board.close()
console.log(run.passed ? "all passed" : "failed")

await mkdir(out, { recursive: true })
await writeFile(join(out, "bench-results.json"), stringifyRun(run))
await writeFile(join(out, "junit.xml"), toJunit(run))
await writeFile(join(out, "bench-report.md"), toMarkdown(run))
console.log(`wrote ${join(out, "bench-results.json")}, junit.xml and bench-report.md`)
process.exitCode = run.passed ? 0 : 1
