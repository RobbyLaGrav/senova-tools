// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { loadResults, parseResults, ResultsError, s, validateResults, type Infer } from "../src/index.ts"

const schema = s.object({
  note: s.string({ pattern: /simulat/i }),
  version: s.literal(1),
  methods: s.array(s.object({ id: s.string(), rms: s.number({ min: 0 }), runs: s.number({ integer: true }) }), { minLength: 1 }),
  extra: s.optional(s.record(s.boolean())),
})
type Results = Infer<typeof schema>

const good = { note: "Simulated; nothing measured on hardware.", version: 1, methods: [{ id: "a", rms: 0.2, runs: 3 }] }

test("valid results pass and come back typed", () => {
  const r: Results = parseResults(JSON.stringify(good), schema)
  assert.equal(r.methods[0]?.rms, 0.2)
  assert.equal(r.extra, undefined)
})

test("every problem is listed with its path, not just the first", () => {
  const bad = { note: "Measured.", version: 2, methods: [{ id: 3, rms: -1, runs: 1.5 }], extra: { x: "yes" } }
  const r = validateResults(bad, schema)
  assert.equal(r.ok, false)
  if (r.ok) return
  const paths = r.issues.map((i) => i.path)
  assert.deepEqual(paths, ["note", "version", "methods[0].id", "methods[0].rms", "methods[0].runs", "extra.x"])
  assert.match(r.issues[0]?.message ?? "", /must match/)
})

test("missing keys, NaN, Infinity and wrong containers are caught", () => {
  const issues = (v: unknown) => {
    const r = validateResults(v, schema)
    return r.ok ? [] : r.issues.map((i) => `${i.path}: ${i.message}`)
  }
  assert.deepEqual(issues({ ...good, methods: undefined }), ["methods: is missing"])
  assert.deepEqual(issues({ ...good, methods: [] }), ["methods: needs at least 1 items, has 0"])
  assert.match(issues({ ...good, methods: [{ id: "a", rms: Number.NaN, runs: 1 }] })[0] ?? "", /finite/)
  assert.match(issues({ ...good, methods: [{ id: "a", rms: Infinity, runs: 1 }] })[0] ?? "", /finite/)
  assert.match(issues([])[0] ?? "", /expected an object, got an array/)
  assert.match(issues(null)[0] ?? "", /got null/)
})

test("strict objects reject unexpected keys; others allow them", () => {
  assert.equal(validateResults({ a: 1, b: 2 }, s.object({ a: s.number() })).ok, true)
  const r = validateResults({ a: 1, b: 2 }, s.object({ a: s.number() }, { strict: true }))
  assert.equal(r.ok, false)
  if (!r.ok) assert.deepEqual(r.issues, [{ path: "b", message: "is not expected here" }])
})

test("odd keys get bracketed paths, and unions, tuples and oneOf work", () => {
  const r = validateResults({ "the key": "x" }, s.object({ "the key": s.number() }))
  assert.equal(r.ok ? "" : r.issues[0]?.path, '["the key"]')
  const u = s.union(s.string(), s.number())
  assert.equal(validateResults(3, u).ok, true)
  assert.equal(validateResults(true, u).ok, false)
  const t = s.tuple(s.string(), s.number())
  assert.equal(validateResults(["a", 1], t).ok, true)
  assert.equal(validateResults(["a"], t).ok, false)
  assert.equal(validateResults("c", s.string({ oneOf: ["a", "b"] })).ok, false)
  assert.equal(validateResults(5, s.number({ max: 4 })).ok, false)
})

test("loadResults reads a file; errors name the file and the problem", () => {
  const dir = mkdtempSync(join(tmpdir(), "honest-"))
  try {
    const file = join(dir, "results.json")
    writeFileSync(file, JSON.stringify(good))
    assert.equal(loadResults(file, schema).methods.length, 1)

    writeFileSync(file, "{ not json")
    assert.throws(() => loadResults(file, schema), (e: unknown) => e instanceof ResultsError && /not valid JSON/.test(e.message) && e.message.includes(file))

    writeFileSync(file, JSON.stringify({ ...good, note: "Measured on the bench." }))
    assert.throws(() => loadResults(file, schema), (e: unknown) => e instanceof ResultsError && e.issues.length === 1 && /note: must match/.test(e.message))

    assert.throws(() => loadResults(join(dir, "missing.json"), schema), /could not be read \(ENOENT\)/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
