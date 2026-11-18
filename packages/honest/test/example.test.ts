// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// The README example runs, its sentences follow the data when the data changes, and the package's own README and
// source pass the claim checker (the rules file and README examples are fenced off with ignore directives).
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import { article } from "../examples/article.ts"
import { checkPaths, loadConfig } from "../src/index.ts"

const pkg = fileURLToPath(new URL("..", import.meta.url))
const results = new URL("../examples/results.json", import.meta.url)

test("the README example prints what the README says", () => {
  assert.deepEqual(article(results), [
    "The mid threshold setting did 5.1× less arithmetic than the dense network (largest saving within 10 % extra error).",
    "Its most accurate setting matched the dense network (both 0.30 mm).",
    "Simulated results. Nothing here was measured on hardware.",
  ])
  const readme = readFileSync(join(pkg, "README.md"), "utf8")
  for (const line of article(results)) assert.ok(readme.includes(line), `README shows: ${line}`)
})

test("a re-run with different numbers rewrites the sentences", () => {
  const data = JSON.parse(readFileSync(results, "utf8"))
  data.settings = [
    { name: "a", rms_mm: 0.5, ops: 100 },
    { name: "b", rms_mm: 0.4, ops: 200 },
  ]
  const dir = mkdtempSync(join(tmpdir(), "honest-"))
  try {
    const file = join(dir, "results.json")
    writeFileSync(file, JSON.stringify(data))
    const [headline, accuracy] = article(file)
    assert.equal(headline, "No setting saved arithmetic within 10 % extra error of the dense network.")
    assert.equal(accuracy, "Its most accurate setting did not beat the dense network (0.40 mm against 0.30 mm).")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("the example draft fails the checker with the example config, rule by rule", () => {
  const config = loadConfig(join(pkg, "examples", "honest.config.json"))
  const r = checkPaths(["examples/draft.md"], { cwd: pkg, config })
  assert.deepEqual(r.findings.map((f) => `${f.rule}:${f.severity}`), [
    "simulation-note:error",
    "hype:error",
    "hardware-claim:error",
    "vendor-figure:error",
    "price:warn",
    "insecure-source:error",
  ])
})

test("this package's README and source pass its own checker", () => {
  const r = checkPaths(["README.md", "src"], { cwd: pkg })
  assert.deepEqual(r.findings.map((f) => `${f.file}:${f.line} ${f.rule} ${f.match}`), [])
  assert.ok(r.files.length >= 8)
})
