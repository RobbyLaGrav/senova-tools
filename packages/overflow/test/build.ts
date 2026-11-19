// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Hand-built snapshots for the rule tests. `page()` starts html > body at a viewport; `add()` appends an element
// whose scroll and client sizes default to its box, so a test only states what matters.
import type { Snapshot, SnapshotElement } from "../src/types.ts"

export type Extra = Partial<Omit<SnapshotElement, "parent" | "tag" | "rect" | "selector">> & { selector?: string }

export class Page {
  readonly snap: Snapshot
  constructor(width = 1280, height = 800, opts: { direction?: "ltr" | "rtl"; docWidth?: number } = {}) {
    this.snap = {
      overflow: 1,
      viewport: { width, height },
      document: { scrollWidth: opts.docWidth ?? width, scrollHeight: height, clientWidth: width, clientHeight: height },
      elements: [],
    }
    if (opts.direction) this.snap.direction = opts.direction
    this.add(null, "html", [0, 0, width, height])
    this.add(0, "body", [0, 0, width, height])
  }
  get els(): SnapshotElement[] {
    return this.snap.elements
  }
  add(parent: number | null, tag: string, rect: [number, number, number, number], extra: Extra = {}): number {
    const [x, y, width, height] = rect
    const cls = extra.classes?.length ? "." + extra.classes.join(".") : ""
    const own = `${tag}${extra.id ? "#" + extra.id : ""}${cls}${extra.nth ? `:nth-of-type(${extra.nth})` : ""}`
    const e: SnapshotElement = {
      parent,
      tag,
      rect: { x, y, width, height },
      scrollWidth: Math.round(width),
      scrollHeight: Math.round(height),
      clientWidth: Math.round(width),
      clientHeight: Math.round(height),
      overflowX: "visible",
      overflowY: "visible",
      whiteSpace: "normal",
      fontSize: 16,
      lineHeight: 24,
      ...extra,
      selector: extra.selector ?? (parent === null ? own : `${this.els[parent]!.selector} > ${own}`),
    }
    this.els.push(e)
    return this.els.length - 1
  }
  /** A list of rows (`li` by default) with cells starting at the given x positions, 40 px apart vertically. */
  list(parent: number, rows: number[][], opts: { rowTag?: string; cellTag?: string; y?: number; x?: number; rowExtra?: Extra; dir?: "rtl" } = {}): number {
    const ul = this.add(parent, opts.rowTag === "tr" ? "table" : "ul", [opts.x ?? 0, opts.y ?? 100, 600, rows.length * 40], opts.dir ? { direction: "rtl" } : {})
    rows.forEach((starts, k) => {
      const y = (opts.y ?? 100) + k * 40
      const row = this.add(ul, opts.rowTag ?? "li", [opts.x ?? 0, y, 600, 40], { nth: k + 1, ...opts.rowExtra, ...(opts.dir ? { direction: "rtl" } : {}) })
      starts.forEach((x, c) => {
        // In RTL the numbers are right edges; cells are 80 px wide.
        const left = opts.dir === "rtl" ? x - 80 : x
        this.add(row, opts.cellTag ?? "span", [left, y + 10, 80, 20], { nth: c + 1, text: `r${k}c${c}`, ...(opts.dir ? { direction: "rtl" } : {}) })
      })
    })
    return ul
  }
}
