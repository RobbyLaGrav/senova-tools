// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"

import { computePart, defineExperiment, mergeParts, partialPath, runPart, type ExperimentConfig, type PartFn } from "../src/index.ts"

const dirs: string[] = []
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), "seedrun-test-"))
  dirs.push(d)
  return d
}
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })))
const quiet = { log: () => {} }

const noise: PartFn = ({ rng }) => ({ values: Array.from({ length: 100 }, () => rng.normal()) })
const config = (overrides: Partial<ExperimentConfig> = {}): ExperimentConfig => ({
  name: "demo",
  seed: 11,
  parts: {
    noise,
    dice: { run: ({ rng }) => ({ rolls: Array.from({ length: 20 }, () => rng.int(1, 7)) }), description: "twenty rolls" },
    fixed: { run: ({ seed }) => ({ seed }), seed: 99 },
  },
  ...overrides,
})

test("same seed, same bytes: two runs into separate folders give identical files", async () => {
  const exp = defineExperiment(config())
  const [a, b] = [tempDir(), tempDir()]
  for (const out of [a, b]) for (const p of exp.parts) await runPart(exp, p.name, { outDir: out, ...quiet })
  for (const p of exp.parts) assert.equal(readFileSync(partialPath(a, p.name), "utf8"), readFileSync(partialPath(b, p.name), "utf8"))
  const ma = await mergeParts(exp, { outDir: a, resultsFile: join(a, "results.json") })
  const mb = await mergeParts(exp, { outDir: b, resultsFile: join(b, "results.json") })
  assert.equal(readFileSync(join(a, "results.json"), "utf8"), readFileSync(join(b, "results.json"), "utf8"))
  assert.equal(ma.sha256, mb.sha256)
})

test("a different experiment seed gives different bytes; a part's fixed seed doesn't move", async () => {
  const a = defineExperiment(config())
  const b = defineExperiment(config({ seed: 12 }))
  assert.notEqual((await computePart(a, "noise", quiet)).json, (await computePart(b, "noise", quiet)).json)
  assert.equal(a.parts.find((p) => p.name === "fixed")?.seed, 99)
  assert.equal(b.parts.find((p) => p.name === "fixed")?.seed, 99)
})

test("a part's output doesn't depend on which other parts exist or the order they run in", async () => {
  const full = defineExperiment(config())
  const alone = defineExperiment({ name: "demo", seed: 11, parts: { noise } })
  assert.equal((await computePart(full, "noise", quiet)).json, (await computePart(alone, "noise", quiet)).json)
})

test("merge keeps the config's part order and records each part's seed", async () => {
  const exp = defineExperiment(config({ merge: (r, info) => ({ order: info.parts, keys: Object.keys(r) }) }))
  const out = tempDir()
  for (const name of ["fixed", "dice", "noise"]) await runPart(exp, name, { outDir: out, ...quiet })
  const m = await mergeParts(exp, { outDir: out })
  assert.deepEqual(m.results.results, { order: ["noise", "dice", "fixed"], keys: ["noise", "dice", "fixed"] })
  assert.equal(m.results.parts.fixed, 99)
  assert.equal(m.file, undefined)
})

test("merge refuses missing parts and names the command to run", async () => {
  const exp = defineExperiment(config())
  const out = tempDir()
  await runPart(exp, "noise", { outDir: out, ...quiet })
  await assert.rejects(mergeParts(exp, { outDir: out }), /missing results for "dice", "fixed".*seedrun run dice fixed/)
})

test("merge refuses stale partial files (seed or version changed) and broken ones", async () => {
  const out = tempDir()
  const old = defineExperiment(config({ version: "1" }))
  for (const p of old.parts) await runPart(old, p.name, { outDir: out, ...quiet })
  await assert.rejects(mergeParts(defineExperiment(config({ version: "2" })), { outDir: out }), /version "1".*"2"/)
  await assert.rejects(mergeParts(defineExperiment(config({ version: "1", seed: 12 })), { outDir: out }), /experiment seed 11/)
  writeFileSync(partialPath(out, "dice"), "{ not json")
  await assert.rejects(mergeParts(old, { outDir: out }), /not valid JSON/)
})

test("Math.random is blocked inside parts unless allowed, and restored afterwards", async () => {
  const parts = { r: () => ({ x: Math.random() }) }
  await assert.rejects(computePart(defineExperiment({ name: "m", seed: 1, parts }), "r", quiet), /Math\.random\(\) is not seeded/)
  assert.equal(typeof Math.random(), "number")
  const ok = await computePart(defineExperiment({ name: "m", seed: 1, parts, allowMathRandom: true }), "r", quiet)
  assert.match(ok.json, /"x":/)
})

test("async parts work; logs go to the log function, never into the file", async () => {
  const lines: string[] = []
  const exp = defineExperiment({
    name: "a",
    seed: 1,
    parts: {
      slow: async ({ log }) => {
        log("hello")
        return await Promise.resolve({ ok: true })
      },
    },
  })
  const out = await computePart(exp, "slow", { log: (l) => lines.push(l) })
  assert.deepEqual(lines, ["[slow] hello"])
  assert.doesNotMatch(out.json, /hello/)
})

test("a part that returns undefined or non-JSON data fails clearly", async () => {
  const exp = defineExperiment({ name: "u", seed: 1, parts: { none: () => undefined, nan: () => ({ v: Number.NaN }) } })
  await assert.rejects(computePart(exp, "none", quiet), /returned undefined/)
  await assert.rejects(computePart(exp, "nan", quiet), /\$\.result\.v is NaN/)
  await assert.rejects(computePart(exp, "nope", quiet), /no part "nope".*parts: none, nan/)
})

test("defineExperiment refuses bad configs", () => {
  const run = () => 1
  assert.throws(() => defineExperiment({ name: "", seed: 1, parts: { a: run } }), /name/)
  assert.throws(() => defineExperiment({ name: "x", seed: -1, parts: { a: run } }), /seed/)
  assert.throws(() => defineExperiment({ name: "x", seed: 1, parts: {} }), /at least one part/)
  assert.throws(() => defineExperiment({ name: "x", seed: 1, parts: { "../evil": run } }), /part name/)
  assert.throws(() => defineExperiment({ name: "x", seed: 1, parts: { all: run } }), /reserved/)
  assert.throws(() => defineExperiment({ name: "x", seed: 1, parts: { A: run, a: run } }), /letter case/)
  assert.throws(() => defineExperiment({ name: "x", seed: 1, parts: { a: { run, seed: 1.5 } } }), /part "a" seed/)
})
