// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Config validation, ignore directives, directory scans and positions.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { checkPaths, checkText, ConfigError, globToRegExp, loadConfig, resolveRules, validateConfig, type ClaimRule } from "../src/index.ts"

test("findings carry file, 1-based line and column, rule, severity, match and hint", () => {
  const [f] = checkText("Fine line.\n  A breakthrough here.", { file: "notes.md" })
  assert.deepEqual({ ...f, hint: undefined }, {
    rule: "hype",
    severity: "error",
    file: "notes.md",
    line: 2,
    column: 5,
    match: "breakthrough",
    message: '"breakthrough" is a hype word (breakthrough).',
    hint: undefined,
  })
  assert.ok(f?.hint)
})

test("ignore directives: line, next line, block, file, and per rule", () => {
  assert.deepEqual(checkText("A breakthrough. <!-- honest-ignore-line -->"), [])
  assert.deepEqual(checkText("// honest-ignore-next-line hype -- quoting a press release\nA breakthrough."), [])
  assert.deepEqual(checkText("<!-- honest-ignore-start -->\nA breakthrough.\nIt is proven.\n<!-- honest-ignore-end -->"), [])
  assert.equal(checkText("<!-- honest-ignore-start -->\nA breakthrough.\n<!-- honest-ignore-end -->\nIt is proven.").length, 1)
  assert.deepEqual(checkText("<!-- honest-ignore-file hype -->\nA breakthrough.\nIt is proven."), [])
  // a directive for one rule leaves the others on
  const f = checkText("A breakthrough at $5. <!-- honest-ignore-line price -->")
  assert.deepEqual(f.map((x) => x.rule), ["hype"])
})

test("code files split sentences at line breaks, so a negation can't leak to the next line", () => {
  const src = 'const a = "Nothing was measured on hardware"\nconst b = "We measured it on our chip"'
  assert.equal(checkText(src, { file: "a.ts" }).filter((f) => f.rule === "hardware-claim").length, 1)
})

test("config validation rejects typos, bad severities, bad options and bad patterns", () => {
  assert.throws(() => resolveRules({ rules: { hpye: "error" } }), (e: unknown) => e instanceof ConfigError && /Unknown rule "hpye"/.test(e.message))
  assert.throws(() => validateConfig({ rules: { hype: "loud" } }), ConfigError)
  assert.throws(() => validateConfig({ rules: { hype: ["error"] } }), ConfigError)
  assert.throws(() => validateConfig({ rule: {} }), /rule: is not expected here/)
  assert.throws(() => resolveRules({ rules: { hype: ["error", { ad: ["x"] }] } }), /rules\.hype options: ad is not expected here/)
  assert.throws(() => resolveRules({ rules: { "hardware-claim": ["error", { add: ["(unclosed"] }] } }), /invalid pattern/)
  assert.throws(() => resolveRules({ custom: [{ id: "x-y", pattern: "[", message: "m" }] }), /custom rule x-y/)
  assert.throws(() => resolveRules({ custom: [{ id: "hype", pattern: "x", message: "m" }] }), /share the id "hype"/)
  assert.equal(validateConfig({ rules: { hype: ["warn", { add: ["epic"] }] }, extensions: [".md"] }).extensions?.[0], ".md")
})

test("library users can add their own rule objects", () => {
  const rule: ClaimRule = {
    id: "todo",
    summary: "No TODOs in published text.",
    defaultSeverity: "warn",
    check: (doc) => [...doc.text.matchAll(/TODO/g)].map((m) => ({ index: m.index, length: 4, message: "TODO left in." })),
  }
  const f = checkText("Done.\nTODO: numbers", { rules: [rule] })
  assert.deepEqual(f.map((x) => [x.rule, x.severity, x.line]), [["todo", "warn", 2]])
})

test("globs: name patterns match at any depth, path patterns from the root", () => {
  assert.ok(globToRegExp("drafts").test("docs/drafts/a.md"))
  assert.ok(globToRegExp("drafts/**").test("drafts/x/y.md"))
  assert.ok(!globToRegExp("drafts/**").test("docs/drafts/a.md"))
  assert.ok(globToRegExp("*.gen.ts").test("src/a.gen.ts"))
  assert.ok(!globToRegExp("*.gen.ts").test("src/a.ts"))
  assert.ok(globToRegExp("docs/**/old.md").test("docs/old.md"))
  assert.ok(globToRegExp("a?.md").test("ab.md"))
})

test("checkPaths walks folders by extension, skips ignored paths, and always reads named files", () => {
  const dir = mkdtempSync(join(tmpdir(), "honest-"))
  try {
    mkdirSync(join(dir, "docs", "drafts"), { recursive: true })
    mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true })
    writeFileSync(join(dir, "docs", "a.md"), "A breakthrough.\n")
    writeFileSync(join(dir, "docs", "b.tsx"), 'export const t = "It is proven."\n')
    writeFileSync(join(dir, "docs", "c.png"), "A breakthrough.")
    writeFileSync(join(dir, "docs", "bin.md"), "A breakthrough.\u0000")
    writeFileSync(join(dir, "docs", "drafts", "d.md"), "A breakthrough.\n")
    writeFileSync(join(dir, "node_modules", "pkg", "e.md"), "A breakthrough.\n")
    writeFileSync(join(dir, "notes.custom"), "A breakthrough.\n")

    const r = checkPaths(["."], { cwd: dir, config: { ignore: ["drafts/**", "docs/drafts"] } })
    assert.deepEqual(r.findings.map((f) => f.file), ["docs/a.md", "docs/b.tsx"])
    assert.ok(!r.files.includes("docs/c.png"))

    const md = checkPaths(["docs"], { cwd: dir, config: { extensions: [".md"] } })
    assert.deepEqual(md.findings.map((f) => f.file), ["docs/a.md", "docs/drafts/d.md"])

    assert.equal(checkPaths(["notes.custom"], { cwd: dir }).findings.length, 1)
    assert.throws(() => checkPaths(["missing"], { cwd: dir }), /ENOENT/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("loadConfig reports unreadable, malformed and invalid files by name", () => {
  const dir = mkdtempSync(join(tmpdir(), "honest-"))
  try {
    const file = join(dir, "honest.config.json")
    assert.throws(() => loadConfig(file), /Could not read config/)
    writeFileSync(file, "{")
    assert.throws(() => loadConfig(file), /is not valid JSON/)
    writeFileSync(file, JSON.stringify({ extensions: ["md"] }))
    assert.throws(() => loadConfig(file), (e: unknown) => e instanceof ConfigError && e.message.includes(file) && /extensions\[0\]/.test(e.message))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
