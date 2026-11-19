// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Bad input fails closed with the path of the bad field: snapshots, configs and selectors.
import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { check, InputError, matches, parseConfig, parseSelector, parseSnapshot, resolveConfig, validateSnapshot } from "../src/index.ts"
import { Page } from "./build.ts"

const rejects = (fn: () => unknown, re: RegExp) => assert.throws(fn, (err: unknown) => err instanceof InputError && re.test(err.message))

describe("snapshot validation", () => {
  test("a hand-built snapshot is valid and survives JSON", () => {
    const p = new Page()
    p.add(1, "div", [0, 0, 10, 10])
    assert.deepEqual(parseSnapshot(JSON.stringify(p.snap)), p.snap)
  })

  test("not JSON, not an object, or the wrong format version", () => {
    rejects(() => parseSnapshot("{oops"), /not valid JSON/)
    rejects(() => validateSnapshot([]), /must be a JSON object, got an array/)
    rejects(() => validateSnapshot(null), /got null/)
    rejects(() => validateSnapshot({ ...new Page().snap, overflow: 2 }), /^overflow: must be 1/)
  })

  test("viewport, document and elements are required and typed", () => {
    const base = new Page().snap
    rejects(() => validateSnapshot({ ...base, viewport: undefined }), /^viewport:/)
    rejects(() => validateSnapshot({ ...base, viewport: { width: 0, height: 800 } }), /^viewport.width: must be 1 or more/)
    rejects(() => validateSnapshot({ ...base, document: { ...base.document, scrollWidth: "1280" } }), /^document.scrollWidth: must be a finite number, got "1280"/)
    rejects(() => validateSnapshot({ ...base, elements: {} }), /^elements: must be an array/)
    rejects(() => validateSnapshot({ ...base, direction: "up" }), /^direction: must be "ltr" or "rtl"/)
    rejects(() => validateSnapshot({ ...base, truncated: "yes" }), /^truncated:/)
  })

  test("element fields name their index", () => {
    const bad = (patch: Record<string, unknown>, re: RegExp) => {
      const p = new Page()
      Object.assign(p.els[1]!, patch)
      rejects(() => validateSnapshot(JSON.parse(JSON.stringify(p.snap))), re)
    }
    bad({ rect: { x: 0, y: 0, width: -1, height: 5 } }, /^elements\[1\]\.rect\.width: must be 0 or more/)
    bad({ rect: null }, /^elements\[1\]\.rect:/)
    bad({ scrollWidth: null }, /^elements\[1\]\.scrollWidth: must be a finite number, got null/)
    bad({ overflowX: "overlay" }, /^elements\[1\]\.overflowX: must be one of/)
    bad({ parent: 1 }, /^elements\[1\]\.parent: must point to an earlier element/)
    bad({ parent: 0.5 }, /^elements\[1\]\.parent: must be a whole number/)
    bad({ tag: "" }, /^elements\[1\]\.tag: must not be empty/)
    bad({ colour: "red" }, /^elements\[1\]\.colour: is not a snapshot field/)
    bad({ classes: "a b" }, /^elements\[1\]\.classes: must be an array/)
    bad({ attrs: { role: 3 } }, /^elements\[1\]\.attrs\.role: must be a string/)
    bad({ lines: ["ok", 2] }, /^elements\[1\]\.lines\[1\]: must be a string/)
    bad({ lineClamp: 0 }, /^elements\[1\]\.lineClamp: must be 1 or more/)
    bad({ visible: "no" }, /^elements\[1\]\.visible:/)
  })

  test("NaN never gets through (JSON turns it into null, code might pass it directly)", () => {
    const p = new Page()
    p.els[1]!.fontSize = Number.NaN
    rejects(() => check(p.snap), /^elements\[1\]\.fontSize: must be a finite number/)
  })
})

describe("config", () => {
  test("defaults", () => {
    const c = resolveConfig()
    assert.equal(c.maxTitleLines, 2)
    assert.deepEqual(c.tolerance, { column: 2, overflow: 1, page: 1 })
    assert.deepEqual(c.allowScroll, ["textarea", "select"])
    assert.equal(c.failOn, "warning")
    assert.equal(c.rules["page-overflow-x"], "error")
  })

  test("overrides merge with defaults", () => {
    const c = parseConfig('{"tolerance":{"column":4},"rules":{"title-widow":"off"},"failOn":"error","viewportLabel":"phone"}')
    assert.deepEqual(c.tolerance, { column: 4, overflow: 1, page: 1 })
    assert.equal(c.rules["title-widow"], "off")
    assert.equal(c.rules["title-wraps"], "warning")
    assert.equal(c.failOn, "error")
    assert.equal(c.viewportLabel, "phone")
  })

  test("typos and bad values are refused", () => {
    rejects(() => resolveConfig({ tolerence: {} }), /^tolerence: is not a config field/)
    rejects(() => resolveConfig({ tolerance: { gap: 1 } }), /^tolerance.gap: is not a tolerance/)
    rejects(() => resolveConfig({ tolerance: { column: -1 } }), /^tolerance.column: must be a number of pixels/)
    rejects(() => resolveConfig({ rules: { "inner-scroll": "off" } }), /^rules.inner-scroll: is not a rule/)
    rejects(() => resolveConfig({ rules: { "inner-scrollbar": "fatal" } }), /^rules.inner-scrollbar: must be one of info, warning, error, off/)
    rejects(() => resolveConfig({ failOn: "off" }), /^failOn: must be one of info, warning, error, never/)
    rejects(() => resolveConfig({ maxTitleLines: 0 }), /^maxTitleLines: must be a whole number of 1 or more/)
    rejects(() => resolveConfig({ minRows: 1 }), /^minRows: must be a whole number of 2 or more/)
    rejects(() => resolveConfig({ ignore: ".a" }), /^ignore: must be an array/)
    rejects(() => resolveConfig({ ignore: ["a:hover"] }), /^ignore\[0\]: selector "a:hover": only :nth-of-type/)
    rejects(() => resolveConfig("x"), /must be a JSON object/)
    rejects(() => parseConfig("{"), /config is not valid JSON/)
  })
})

describe("selectors", () => {
  const p = new Page()
  const main = p.add(1, "main", [0, 0, 100, 100], { id: "app", classes: ["shell", "dark"] })
  const list = p.add(main, "ul", [0, 0, 100, 100], { attrs: { role: "list", "data-kind": "team-members" } })
  const li2 = p.add(list, "li", [0, 0, 100, 10], { nth: 2, classes: ["row"] })
  const odd = p.add(main, "div", [0, 0, 1, 1], { id: "123", classes: ["a:b"] })
  const is = (sel: string, i: number) => matches(parseSelector(sel), p.els, i)

  test("tags, ids, classes and the universal selector", () => {
    assert.ok(is("li", li2))
    assert.ok(is("*", li2))
    assert.ok(is("#app", main))
    assert.ok(is("main#app.shell.dark", main))
    assert.ok(!is("main.light", main))
    assert.ok(is("LI", li2), "tag names are case-insensitive")
  })

  test("attributes", () => {
    assert.ok(is("[role]", list))
    assert.ok(is('[role="list"]', list))
    assert.ok(is("[data-kind^=team]", list))
    assert.ok(is("[data-kind$='members']", list))
    assert.ok(is("[data-kind*=m-m]", list))
    assert.ok(is("[class~=shell]", main))
    assert.ok(is("[id=app]", main))
    assert.ok(!is("[data-kind^='']", list), "empty prefix matches nothing, as in CSS")
    assert.ok(!is("[hidden]", list))
  })

  test("combinators, nth-of-type and lists", () => {
    assert.ok(is("main li", li2))
    assert.ok(is("body > main > ul > li:nth-of-type(2)", li2))
    assert.ok(!is("main > li", li2))
    assert.ok(!is("li:nth-of-type(1)", li2))
    assert.ok(is("p, li.row", li2))
    assert.ok(is(p.els[li2]!.selector, li2), "the collector's own selector paths match")
  })

  test("CSS escapes, as CSS.escape writes them", () => {
    assert.ok(is("#\\31 23", odd))
    assert.ok(is(".a\\:b", odd))
  })

  test("unsupported or broken syntax is refused, not ignored", () => {
    for (const [sel, re] of [
      ["", /non-empty/],
      ["a + b", /sibling combinators/],
      ["a ~ b", /sibling combinators/],
      ["a:first-child", /only :nth-of-type/],
      ["[x|=y]", /expected "\]"/],
      ["[x='y]", /unclosed quote/],
      ["a,", /expected a selector/],
      ["a >", /expected a selector/],
      ["a)", /unexpected "\)"/],
    ] as const) rejects(() => parseSelector(sel), re)
  })
})
