// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// The collector's shipped source text, run against a fake DOM in a fresh `vm` context (no access to this module),
// then checked end to end. This proves the source is self-contained and that its output passes validation.
import assert from "node:assert/strict"
import vm from "node:vm"
import { describe, test } from "node:test"

import { bookmarklet, check, collectorExpression, COLLECTOR_SOURCE, validateSnapshot, type Snapshot } from "../src/index.ts"
import { runInFakePage, type Spec } from "./fake-dom.ts"

const row = (y: number, roleX: number): Spec => ({
  tag: "li",
  rect: [0, y, 400, 40],
  children: [
    { tag: "span", cls: "name", rect: [0, y + 10, 100, 20], text: "Name" },
    { tag: "span", cls: "role", rect: [roleX, y + 10, 100, 20], text: "Role" },
  ],
})

const PAGE: Spec = {
  tag: "html",
  rect: [0, 0, 800, 1000],
  scroll: [800, 1000],
  children: [
    { tag: "head", children: [{ tag: "title", text: "x" }] },
    {
      tag: "body",
      rect: [0, 0, 800, 1000],
      children: [
        { tag: "script", text: "var secret = 1" },
        {
          tag: "div",
          id: "app",
          cls: "shell",
          rect: [0, 0, 800, 1000],
          children: [
            { tag: "h2", cls: "title", rect: [0, 0, 120, 60], text: "Settings for every team member" },
            { tag: "div", cls: "panel", rect: [0, 100, 300, 200], scroll: [300, 900], style: { overflowY: "auto" }, attrs: { "data-kind": "panel" } },
            { tag: "div", style: { display: "none" }, children: [{ tag: "h1", rect: [0, 0, 0, 0], text: "Hidden" }] },
            { tag: "ul", cls: "team", rect: [0, 320, 400, 120], children: [row(320, 100), row(360, 120), row(400, 100)] },
            { tag: "span", cls: "ghost", rect: [0, 450, 50, 20], style: { visibility: "hidden" }, text: "ghost" },
            {
              tag: "p",
              cls: "clip",
              rect: [0, 480, 200, 20],
              scroll: [260, 20],
              style: { overflowX: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", lineHeight: "20px" },
              children: [{ tag: "b", rect: [0, 480, 260, 20], text: "A long label that does not fit" }],
            },
            { tag: "td", rect: [0, 520, 100, 20], colSpan: 2 },
          ],
        },
      ],
    },
  ],
}

describe("collector", () => {
  const snap = runInFakePage(PAGE, collectorExpression({ label: "fake" })) as Snapshot

  test("its output is a valid snapshot", () => {
    validateSnapshot(snap)
    assert.equal(snap.overflow, 1)
    assert.deepEqual(snap.viewport, { width: 800, height: 600, label: "fake" })
    assert.deepEqual(snap.document, { scrollWidth: 800, scrollHeight: 1000, clientWidth: 800, clientHeight: 1000 })
    assert.equal(snap.direction, "ltr")
    assert.equal(snap.truncated, undefined)
    assert.match(snap.takenAt!, /^\d{4}-\d\d-\d\dT/)
  })

  test("drops the query string and hash from the URL unless asked", () => {
    assert.equal(snap.url, "http://127.0.0.1:8080/app")
    const full = runInFakePage(PAGE, collectorExpression({ fullUrl: true })) as Snapshot
    assert.equal(full.url, "http://127.0.0.1:8080/app?token=abc#top")
  })

  test("skips head, scripts and display: none subtrees; keeps visibility: hidden marked", () => {
    const tags = snap.elements.map((e) => e.tag)
    assert.ok(!tags.includes("head") && !tags.includes("script") && !tags.includes("title"))
    assert.ok(!tags.includes("h1"), "the h1 inside display: none is not recorded")
    assert.ok(!JSON.stringify(snap).includes("secret"))
    const ghost = snap.elements.find((e) => e.classes?.includes("ghost"))!
    assert.equal(ghost.visible, false)
  })

  test("parents come first, selectors are paths from the nearest unique id", () => {
    snap.elements.forEach((e, i) => assert.ok(e.parent === null || e.parent < i))
    const sels = snap.elements.map((e) => e.selector)
    assert.equal(sels[0], "html")
    assert.ok(sels.includes("div#app"))
    assert.ok(sels.includes("div#app > ul.team > li:nth-of-type(2) > span.role:nth-of-type(2)"))
    assert.ok(sels.includes("div#app > div.panel:nth-of-type(1)"))
  })

  test("records styles, attributes, text and colSpan", () => {
    const panel = snap.elements.find((e) => e.classes?.includes("panel"))!
    assert.equal(panel.overflowY, "auto")
    assert.equal(panel.scrollHeight, 900)
    assert.deepEqual(panel.attrs, { "data-kind": "panel" })
    assert.equal(panel.lineHeight, 19.2, "line-height normal is 1.2 x font size")
    const clip = snap.elements.find((e) => e.classes?.includes("clip"))!
    assert.equal(clip.text, "A long label that does not fit", "clipping boxes keep their descendants' text")
    assert.equal(clip.textOverflow, "ellipsis")
    assert.equal(clip.lineHeight, 20)
    assert.equal(snap.elements.find((e) => e.tag === "td")!.colSpan, 2)
  })

  test("measures the words on each line of a title", () => {
    const h2 = snap.elements.find((e) => e.tag === "h2")!
    assert.deepEqual(h2.lines, ["Settings for", "every team", "member"])
  })

  test("end to end: the rules find the problems in the fake page", () => {
    const report = check(snap)
    const got = report.findings.map((f) => `${f.rule} ${f.selector}`)
    assert.deepEqual(got, [
      "title-wraps div#app > h2.title",
      "inner-scrollbar div#app > div.panel:nth-of-type(1)",
      "column-misaligned div#app > ul.team > li:nth-of-type(2) > span.role:nth-of-type(2)",
      "title-widow div#app > h2.title",
      "text-clipped div#app > p.clip",
    ])
  })

  test("stops at maxElements and says so", () => {
    const small = runInFakePage(PAGE, collectorExpression({ maxElements: 3 })) as Snapshot
    assert.equal(small.elements.length, 3)
    assert.equal(small.truncated, true)
    assert.equal(check(small).truncated, true)
  })

  test("reads the page direction", () => {
    const rtl = runInFakePage({ ...PAGE, style: { direction: "rtl" } }, collectorExpression()) as Snapshot
    assert.equal(rtl.direction, "rtl")
    assert.equal(rtl.elements[0]!.direction, "rtl")
  })

  test("the bookmarklet and the source compile as plain JavaScript", () => {
    assert.match(COLLECTOR_SOURCE, /^function collectLayout\(/)
    const url = bookmarklet({ label: "phone / small" })
    assert.ok(url.startsWith("javascript:"))
    const body = decodeURIComponent(url.slice("javascript:".length))
    assert.doesNotThrow(() => new vm.Script(body))
    assert.match(body, /overflow-phone-small\.json/)
  })
})
