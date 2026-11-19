// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Every rule against hand-built snapshots: what it reports, what it must leave alone, and the edge cases (zero-size
// and hidden elements, RTL, ignore and allow lists, severity overrides).
import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { check } from "../src/index.ts"
import type { Config, Finding, RuleId } from "../src/index.ts"
import { Page } from "./build.ts"

const only = (page: Page, rule: RuleId, config: Config = {}): Finding[] => check(page.snap, config).findings.filter((f) => f.rule === rule)

describe("inner-scrollbar", () => {
  test("reports a box that scrolls vertically, with its sizes", () => {
    const p = new Page()
    p.add(1, "div", [0, 0, 300, 200], { classes: ["panel"], overflowY: "auto", scrollHeight: 900 })
    const [f, ...rest] = only(p, "inner-scrollbar")
    assert.equal(rest.length, 0)
    assert.equal(f!.severity, "warning")
    assert.equal(f!.selector, "html > body > div.panel")
    assert.deepEqual(f!.measured, { axis: "y", scrollWidth: 300, clientWidth: 300, scrollHeight: 900, clientHeight: 200, overflowX: "visible", overflowY: "auto" })
    assert.match(f!.message, /900 px tall in a 200 px box/)
  })

  test("reports both axes", () => {
    const p = new Page()
    p.add(1, "div", [0, 0, 300, 200], { overflowX: "scroll", overflowY: "scroll", scrollWidth: 500, scrollHeight: 400 })
    const [f] = only(p, "inner-scrollbar")
    assert.equal(f!.measured.axis, "both")
  })

  test("ignores content that fits, overflow visible or hidden, and sub-pixel overflow", () => {
    const p = new Page()
    p.add(1, "div", [0, 0, 300, 200], { overflowY: "auto" })
    p.add(1, "div", [0, 0, 300, 200], { overflowY: "visible", scrollHeight: 900 })
    p.add(1, "div", [0, 0, 300, 200], { overflowY: "hidden", scrollHeight: 900 })
    p.add(1, "div", [0, 0, 300, 200], { overflowY: "auto", scrollHeight: 201 })
    assert.deepEqual(only(p, "inner-scrollbar"), [])
  })

  test("never reports the document scroller (html or body)", () => {
    const p = new Page()
    Object.assign(p.els[0]!, { overflowY: "auto", scrollHeight: 5000 })
    Object.assign(p.els[1]!, { overflowY: "auto", scrollHeight: 5000 })
    assert.deepEqual(only(p, "inner-scrollbar"), [])
  })

  test("allowScroll and ignore skip intended scroll boxes; textarea is allowed by default", () => {
    const p = new Page()
    p.add(1, "pre", [0, 0, 300, 200], { overflowX: "auto", scrollWidth: 800 })
    const wrap = p.add(1, "div", [0, 0, 300, 200], { classes: ["carousel"] })
    p.add(wrap, "div", [0, 0, 300, 200], { overflowX: "auto", scrollWidth: 800 })
    p.add(1, "textarea", [0, 0, 300, 200], { overflowY: "auto", scrollHeight: 800 })
    assert.equal(only(p, "inner-scrollbar").length, 2)
    assert.deepEqual(only(p, "inner-scrollbar", { allowScroll: ["pre", "textarea"], ignore: [".carousel"] }), [])
  })

  test("overflow: scroll with nothing to scroll is info", () => {
    const p = new Page()
    p.add(1, "div", [0, 0, 300, 200], { overflowY: "scroll" })
    const [f] = only(p, "inner-scrollbar")
    assert.equal(f!.severity, "info")
    assert.match(f!.message, /empty scrollbar track/)
    assert.equal(f!.measured.axis, "y")
  })

  test("hidden and zero-size boxes are skipped", () => {
    const p = new Page()
    p.add(1, "div", [0, 0, 300, 200], { overflowY: "auto", scrollHeight: 900, visible: false })
    p.add(1, "div", [0, 0, 0, 200], { overflowY: "auto", scrollHeight: 900 })
    p.add(1, "div", [0, 0, 300, 0], { overflowY: "auto", scrollHeight: 900 })
    assert.deepEqual(only(p, "inner-scrollbar"), [])
  })

  test("severity can be raised or the rule turned off", () => {
    const p = new Page()
    p.add(1, "div", [0, 0, 300, 200], { overflowY: "auto", scrollHeight: 900 })
    assert.equal(only(p, "inner-scrollbar", { rules: { "inner-scrollbar": "error" } })[0]!.severity, "error")
    assert.deepEqual(only(p, "inner-scrollbar", { rules: { "inner-scrollbar": "off" } }), [])
  })
})

describe("page-overflow-x", () => {
  test("reports the page and the outermost element that sticks out", () => {
    const p = new Page(375, 800, { docWidth: 440 })
    const main = p.add(1, "main", [0, 0, 375, 800])
    const wide = p.add(main, "div", [0, 0, 440, 100], { classes: ["wide"] })
    p.add(wide, "img", [0, 0, 440, 100]) // inside the culprit: not named separately
    const [page, culprit, ...rest] = only(p, "page-overflow-x")
    assert.equal(rest.length, 0)
    assert.equal(page!.selector, "html")
    assert.equal(page!.severity, "error")
    assert.deepEqual(page!.measured, { scrollWidth: 440, clientWidth: 375, overflow: 65, culprits: 1 })
    assert.equal(culprit!.selector, "html > body > main > div.wide")
    assert.equal(culprit!.measured.overshoot, 65)
  })

  test("nothing when the page fits (within tolerance)", () => {
    const p = new Page(375, 800, { docWidth: 376 })
    p.add(1, "div", [0, 0, 376, 100])
    assert.deepEqual(only(p, "page-overflow-x"), [])
  })

  test("skips elements inside a clipping or scrolling box, and fixed elements", () => {
    const p = new Page(375, 800, { docWidth: 500 })
    const scroller = p.add(1, "div", [0, 0, 375, 100], { overflowX: "auto", scrollWidth: 800 })
    p.add(scroller, "table", [0, 0, 800, 100])
    p.add(1, "div", [300, 0, 200, 50], { position: "fixed" })
    p.add(1, "p", [0, 200, 500, 50])
    const found = only(p, "page-overflow-x")
    assert.deepEqual(found.map((f) => f.selector), ["html", "html > body > p"])
  })

  test("visibility: hidden elements still widen the page", () => {
    const p = new Page(375, 800, { docWidth: 400 })
    p.add(1, "div", [0, 0, 400, 10], { visible: false })
    assert.equal(only(p, "page-overflow-x").length, 2)
  })

  test("caps culprits at maxCulprits, largest first", () => {
    const p = new Page(375, 800, { docWidth: 600 })
    for (let k = 1; k <= 8; k++) p.add(1, "div", [0, k * 10, 375 + k * 10, 10], { nth: k })
    const found = only(p, "page-overflow-x", { maxCulprits: 3 })
    assert.equal(found.length, 4)
    assert.equal(found[0]!.measured.culprits, 8)
    assert.deepEqual(found.slice(1).map((f) => f.measured.overshoot), [80, 70, 60])
  })

  test("RTL pages overflow to the left", () => {
    const p = new Page(375, 800, { direction: "rtl", docWidth: 420 })
    p.add(1, "div", [-45, 0, 420, 50], { classes: ["banner"] })
    p.add(1, "div", [0, 100, 420, 50]) // sticks out on the right: not an RTL overflow
    const found = only(p, "page-overflow-x")
    assert.deepEqual(found.map((f) => f.selector), ["html", "html > body > div.banner"])
    assert.match(found[1]!.message, /left edge/)
  })

  test("says so when no element explains the overflow", () => {
    const p = new Page(375, 800, { docWidth: 400 })
    const [f] = only(p, "page-overflow-x")
    assert.match(f!.message, /no single element found/)
    assert.equal(f!.measured.culprits, 0)
  })
})

describe("column-misaligned", () => {
  test("finds a cell that starts off its column in a list", () => {
    const p = new Page()
    p.list(1, [[0, 120, 300], [0, 134, 300], [0, 120, 300], [0, 120, 300]])
    const [f, ...rest] = only(p, "column-misaligned")
    assert.equal(rest.length, 0)
    assert.equal(f!.selector, "html > body > ul > li:nth-of-type(2) > span:nth-of-type(2)")
    assert.deepEqual(f!.measured, { group: "html > body > ul", column: 2, rows: 4, misaligned: 1, expected: 120, actual: 134, offset: 14, edge: "left" })
  })

  test("aligned columns and differences within the tolerance pass", () => {
    const p = new Page()
    p.list(1, [[0, 120], [0, 121], [0, 122]])
    assert.deepEqual(only(p, "column-misaligned"), [])
    const q = new Page()
    q.list(1, [[0, 120], [0, 130], [0, 120]])
    assert.deepEqual(only(q, "column-misaligned", { tolerance: { column: 10 } }), [])
  })

  test("needs minRows rows", () => {
    const p = new Page()
    p.list(1, [[0, 120], [0, 160]])
    assert.deepEqual(only(p, "column-misaligned"), [])
    assert.equal(only(p, "column-misaligned", { minRows: 2 }).length, 1)
  })

  test("table rows across thead and tbody share columns; colspan rows are skipped", () => {
    const p = new Page()
    const table = p.add(1, "table", [0, 100, 600, 160])
    const head = p.add(table, "thead", [0, 100, 600, 40])
    const body = p.add(table, "tbody", [0, 140, 600, 120])
    const row = (parent: number, y: number, xs: number[], span = false) => {
      const tr = p.add(parent, "tr", [0, y, 600, 40])
      xs.forEach((x, c) => p.add(tr, "td", [x, y, 80, 40], span && c === 0 ? { colSpan: 2 } : {}))
    }
    row(head, 100, [0, 200])
    row(body, 140, [0, 200])
    row(body, 180, [0, 230])
    row(body, 220, [0, 300], true)
    const found = only(p, "column-misaligned")
    assert.equal(found.length, 1)
    assert.equal(found[0]!.measured.rows, 3)
    assert.equal(found[0]!.measured.group, "html > body > table")
  })

  test("lists built from divs (same classes) are checked; a header of another class is not a row", () => {
    const p = new Page()
    const list = p.add(1, "div", [0, 100, 600, 200], { classes: ["list"] })
    const head = p.add(list, "div", [0, 100, 600, 40], { classes: ["head"] })
    p.add(head, "span", [0, 100, 80, 20])
    p.add(head, "span", [200, 100, 80, 20])
    ;[100, 100, 118].forEach((x, k) => {
      const r = p.add(list, "div", [0, 140 + k * 40, 600, 40], { classes: ["item"], nth: k + 2 })
      p.add(r, "span", [0, 150 + k * 40, 80, 20])
      p.add(r, "span", [x, 150 + k * 40, 80, 20])
    })
    const [f] = only(p, "column-misaligned")
    assert.equal(f!.measured.rows, 3)
    assert.equal(f!.measured.offset, 18)
  })

  test("stacked cells (a phone layout) and side-by-side cards are not compared", () => {
    const p = new Page()
    const ul = p.add(1, "ul", [0, 0, 375, 600])
    for (let k = 0; k < 3; k++) {
      const li = p.add(ul, "li", [0, k * 100, 375, 100])
      p.add(li, "span", [0, k * 100, 200, 20])
      p.add(li, "span", [k * 10, k * 100 + 30, 200, 20]) // below the first cell
    }
    const grid = p.add(1, "div", [0, 700, 1200, 300], { classes: ["grid"] })
    for (let k = 0; k < 3; k++) {
      const card = p.add(grid, "div", [k * 400, 700, 380, 300], { classes: ["card"] })
      p.add(card, "img", [k * 400, 700, 380, 200])
      p.add(card, "h3", [k * 400 + 7 * k, 910, 200, 24], { text: "Card" }) // stacked under the image
    }
    assert.deepEqual(only(p, "column-misaligned"), [])
  })

  test("rows that start elsewhere (a second list beside the first) are left out", () => {
    const p = new Page()
    const ul = p.add(1, "ul", [0, 0, 1200, 200])
    const rows: [number, number][] = [[0, 120], [0, 120], [0, 120], [600, 760]]
    rows.forEach(([x0, x1], k) => {
      const li = p.add(ul, "li", [x0, k * 40, 500, 40])
      p.add(li, "span", [x0, k * 40, 80, 20])
      p.add(li, "span", [x1, k * 40, 80, 20])
    })
    assert.deepEqual(only(p, "column-misaligned"), [])
  })

  test("RTL compares right edges", () => {
    const p = new Page()
    p.list(1, [[600, 400], [600, 400], [600, 385]], { dir: "rtl" })
    const [f] = only(p, "column-misaligned")
    assert.equal(f!.measured.edge, "right")
    assert.equal(f!.measured.offset, -15)
  })

  test("hidden rows and hidden cells are skipped", () => {
    const p = new Page()
    p.list(1, [[0, 120], [0, 120], [0, 120], [0, 180]])
    p.els[p.els.length - 3]!.visible = false // the last row
    assert.deepEqual(only(p, "column-misaligned"), [])
  })
})

describe("title-wraps and title-widow", () => {
  test("reports a heading measured on more lines than allowed", () => {
    const p = new Page(375)
    p.add(1, "h1", [16, 0, 343, 144], { text: "A heading that runs on and on", lines: ["A heading that", "runs on and", "on"], fontSize: 40, lineHeight: 48 })
    const [wrap] = only(p, "title-wraps")
    assert.equal(wrap!.severity, "warning")
    assert.deepEqual(wrap!.measured, { lines: 3, maxLines: 2, width: 343, fontSize: 40, lineHeight: 48, estimated: false })
    const [widow] = only(p, "title-widow")
    assert.equal(widow!.severity, "info")
    assert.equal(widow!.measured.lastLine, "on")
  })

  test("estimates lines from height when the collector did not measure them", () => {
    const p = new Page()
    p.add(1, "h2", [0, 0, 300, 96], { text: "Three lines tall", lineHeight: 32 })
    const [f] = only(p, "title-wraps")
    assert.equal(f!.measured.lines, 3)
    assert.equal(f!.measured.estimated, true)
    assert.match(f!.message, /estimated from its height/)
    assert.deepEqual(only(p, "title-widow"), []) // needs measured lines
  })

  test("maxTitleLines, role=heading and titleSelectors", () => {
    const p = new Page()
    p.add(1, "div", [0, 0, 300, 72], { attrs: { role: "heading" }, text: "x y z", lineHeight: 24 })
    p.add(1, "span", [0, 100, 300, 72], { classes: ["card-title"], text: "x y z", lineHeight: 24 })
    p.add(1, "span", [0, 200, 300, 72], { classes: ["other"], text: "x y z", lineHeight: 24 })
    assert.equal(only(p, "title-wraps").length, 1)
    assert.equal(only(p, "title-wraps", { titleSelectors: [".card-title"] }).length, 2)
    assert.equal(only(p, "title-wraps", { titleSelectors: [".card-title"], maxTitleLines: 3 }).length, 0)
  })

  test("no widow for two-word titles, balanced titles, or a last line that continues a word", () => {
    const p = new Page()
    p.add(1, "h2", [0, 0, 100, 48], { text: "Hello world", lines: ["Hello", "world"] })
    p.add(1, "h2", [0, 100, 300, 48], { text: "Set up your first page", lines: ["Set up your first", "page"], textWrap: "balance" })
    p.add(1, "h2", [0, 200, 100, 48], { text: "長い見出しが折り返す", lines: ["長い見出しが折り", ""] })
    assert.deepEqual(only(p, "title-widow"), [])
  })

  test("headings that fit, empty headings, hidden headings and nested titles", () => {
    const p = new Page()
    p.add(1, "h1", [0, 0, 600, 48], { text: "Short", lines: ["Short"] })
    p.add(1, "h2", [0, 100, 600, 96], { text: "   " })
    p.add(1, "h2", [0, 200, 600, 96], { text: "Hidden heading here", visible: false })
    p.add(1, "h3", [0, 300, 0, 96], { text: "Zero width" })
    const outer = p.add(1, "h2", [0, 400, 600, 48], { text: "Outer title", lines: ["Outer title"] })
    p.add(outer, "span", [0, 400, 600, 96], { attrs: { role: "heading" }, text: "inner" })
    assert.deepEqual(only(p, "title-wraps"), [])
  })
})

describe("text-clipped", () => {
  test("reports text cut off by overflow hidden", () => {
    const p = new Page()
    p.add(1, "p", [0, 0, 300, 48], { overflowX: "hidden", overflowY: "hidden", scrollHeight: 96, text: "A paragraph that is too long" })
    const [f] = only(p, "text-clipped")
    assert.equal(f!.severity, "warning")
    assert.equal(f!.measured.axis, "y")
    assert.equal(f!.measured.intentional, false)
    assert.match(f!.message, /48 px cut off at the bottom/)
  })

  test("ellipsis and line-clamp are deliberate: info", () => {
    const p = new Page()
    p.add(1, "span", [0, 0, 100, 24], { overflowX: "hidden", scrollWidth: 300, whiteSpace: "nowrap", textOverflow: "ellipsis", text: "A long label" })
    p.add(1, "p", [0, 50, 300, 48], { overflowX: "hidden", overflowY: "hidden", scrollHeight: 120, lineClamp: 2, text: "Clamped" })
    const found = only(p, "text-clipped")
    assert.deepEqual(found.map((f) => f.severity), ["info", "info"])
    assert.match(found[0]!.message, /with an ellipsis/)
    assert.match(found[1]!.message, /clamped to 2 lines/)
  })

  test("ellipsis does not excuse vertical clipping", () => {
    const p = new Page()
    p.add(1, "div", [0, 0, 100, 24], { overflowX: "hidden", overflowY: "hidden", scrollWidth: 300, scrollHeight: 60, textOverflow: "ellipsis", text: "Both ways" })
    const [f] = only(p, "text-clipped")
    assert.equal(f!.severity, "warning")
    assert.equal(f!.measured.axis, "both")
  })

  test("boxes without text, scroll boxes and RTL wording", () => {
    const p = new Page(1280, 800, { direction: "rtl" })
    p.add(1, "div", [0, 0, 300, 48], { overflowY: "hidden", scrollHeight: 200 })
    p.add(1, "div", [0, 0, 300, 48], { overflowY: "auto", scrollHeight: 200, text: "Scrolls" })
    p.add(1, "div", [0, 100, 100, 24], { overflowX: "clip", scrollWidth: 150, text: "نص طويل", direction: "rtl" })
    const found = only(p, "text-clipped")
    assert.equal(found.length, 1)
    assert.match(found[0]!.message, /cut off on the left/)
  })

  test("ignore covers the element's subtree", () => {
    const p = new Page()
    const ad = p.add(1, "aside", [0, 0, 300, 300], { attrs: { "data-overflow": "skip" } })
    p.add(ad, "p", [0, 0, 300, 48], { overflowY: "hidden", scrollHeight: 96, text: "Clipped" })
    assert.equal(only(p, "text-clipped").length, 1)
    assert.deepEqual(only(p, "text-clipped", { ignore: ["[data-overflow=skip]"] }), [])
  })
})

describe("report", () => {
  test("orders by severity then page order, counts, and labels the viewport", () => {
    const p = new Page(375, 800, { docWidth: 400 })
    p.add(1, "div", [0, 0, 400, 100], { overflowY: "scroll" })
    p.add(1, "div", [0, 100, 300, 100], { overflowY: "auto", scrollHeight: 300 })
    p.snap.url = "http://127.0.0.1:8080/a"
    const r = check(p.snap, { viewportLabel: "phone" })
    assert.deepEqual(r.findings.map((f) => `${f.severity} ${f.rule}`), [
      "error page-overflow-x",
      "error page-overflow-x",
      "warning inner-scrollbar",
      "info inner-scrollbar",
    ])
    assert.deepEqual(r.counts, { error: 2, warning: 1, info: 1 })
    assert.deepEqual(r.viewport, { width: 375, height: 800, label: "phone" })
    assert.equal(r.url, "http://127.0.0.1:8080/a")
    assert.equal(r.elements, 4)
    assert.equal(r.truncated, false)
  })

  test("an empty page and a page with no elements give no findings", () => {
    assert.deepEqual(check(new Page().snap).findings, [])
    const bare = { ...new Page().snap, elements: [] }
    assert.deepEqual(check(bare).findings, [])
  })

  test("is deterministic and JSON-serialisable", () => {
    const p = new Page(375, 800, { docWidth: 420 })
    p.list(1, [[0, 120], [0, 140], [0, 120]])
    p.add(1, "div", [0, 0, 420, 10])
    const a = JSON.stringify(check(p.snap))
    const b = JSON.stringify(check(JSON.parse(JSON.stringify(p.snap))))
    assert.equal(a, b)
  })
})
