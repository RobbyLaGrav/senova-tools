// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Just enough of a DOM to run the collector's source text in a `vm` context: elements with boxes, computed styles,
// text nodes whose words are laid out left to right at a fixed character width, and ranges over them.
import vm from "node:vm"

export interface Spec {
  tag: string
  id?: string
  cls?: string
  attrs?: Record<string, string>
  rect?: [number, number, number, number]
  scroll?: [number, number]
  style?: Record<string, string>
  /** Text content, laid out in the element's box at 10 px per character, wrapping at the box width. */
  text?: string
  colSpan?: number
  children?: Spec[]
}

const DEFAULT_STYLE: Record<string, string> = {
  display: "block", visibility: "visible", overflowX: "visible", overflowY: "visible", position: "static", direction: "ltr",
  whiteSpace: "normal", fontSize: "16px", lineHeight: "normal", textOverflow: "clip",
  "-webkit-line-clamp": "none", "text-wrap": "wrap",
}

class FakeText {
  readonly nodeType = 3
  readonly nodeValue: string
  readonly owner: FakeElement
  constructor(value: string, owner: FakeElement) {
    this.nodeValue = value
    this.owner = owner
  }
  /** Rects for the characters [start, end): one word at a time, wrapping at the owner's width. */
  rects(start: number, end: number): { left: number; top: number; width: number; height: number }[] {
    const [x, y, w] = this.owner.box
    const lh = 20
    let cx = x
    let line = 0
    const re = /\S+/g
    let m: RegExpExecArray | null
    while ((m = re.exec(this.nodeValue)) !== null) {
      const width = m[0].length * 10
      if (cx > x && cx + width > x + w) {
        cx = x
        line++
      }
      if (m.index === start && m.index + m[0].length === end) return [{ left: cx, top: y + line * lh, width, height: lh }]
      cx += width + 10
    }
    return []
  }
}

class FakeElement {
  readonly nodeType = 1
  readonly tagName: string
  readonly attributes: { name: string; value: string }[]
  readonly children: FakeElement[] = []
  readonly childNodes: (FakeElement | FakeText)[] = []
  readonly box: [number, number, number, number]
  readonly scrollWidth: number
  readonly scrollHeight: number
  readonly clientWidth: number
  readonly clientHeight: number
  readonly style: Record<string, string>
  readonly colSpan: number | undefined
  constructor(spec: Spec) {
    this.tagName = spec.tag.toUpperCase()
    this.attributes = Object.entries({ ...(spec.id ? { id: spec.id } : {}), ...(spec.cls ? { class: spec.cls } : {}), ...spec.attrs }).map(([name, value]) => ({ name, value }))
    this.box = spec.rect ?? [0, 0, 0, 0]
    const [, , w, h] = this.box
    this.clientWidth = w
    this.clientHeight = h
    this.scrollWidth = spec.scroll?.[0] ?? w
    this.scrollHeight = spec.scroll?.[1] ?? h
    this.style = { ...DEFAULT_STYLE, ...spec.style }
    this.colSpan = spec.colSpan
    if (spec.text !== undefined) this.childNodes.push(new FakeText(spec.text, this))
    for (const c of spec.children ?? []) {
      const el = new FakeElement(c)
      this.children.push(el)
      this.childNodes.push(el)
    }
  }
  getAttribute(name: string): string | null {
    return this.attributes.find((a) => a.name === name)?.value ?? null
  }
  getBoundingClientRect() {
    const [left, top, width, height] = this.box
    return { left, top, width, height }
  }
  get textContent(): string {
    return this.childNodes.map((n) => (n instanceof FakeText ? n.nodeValue : n.textContent)).join("")
  }
  matches(sel: string): boolean {
    return sel.split(",").some((s) => s.trim().startsWith(".") && (this.getAttribute("class") ?? "").split(" ").includes(s.trim().slice(1)))
  }
  *all(): Generator<FakeElement> {
    yield this
    for (const c of this.children) yield* c.all()
  }
}

/** Runs `expression` (the collector) against a page built from `root` and returns its JSON-cloned result. */
export function runInFakePage(root: Spec, expression: string, opts: { href?: string; innerWidth?: number; innerHeight?: number } = {}): unknown {
  const html = new FakeElement(root)
  const href = opts.href ?? "http://127.0.0.1:8080/app?token=abc#top"
  const u = new URL(href)
  const document = {
    documentElement: html,
    scrollingElement: html,
    querySelectorAll: (sel: string) => [...html.all()].filter((e) => sel.startsWith("#") && e.getAttribute("id") === sel.slice(1)),
    createRange: () => {
      let node: FakeText | undefined
      let start = 0
      let end = 0
      return {
        setStart: (n: FakeText, i: number) => ((node = n), (start = i)),
        setEnd: (_n: FakeText, i: number) => (end = i),
        getClientRects: () => node?.rects(start, end) ?? [],
      }
    },
  }
  const window = {
    scrollX: 0,
    scrollY: 0,
    innerWidth: opts.innerWidth ?? 800,
    innerHeight: opts.innerHeight ?? 600,
    location: { href: u.href, origin: u.origin, pathname: u.pathname },
    getComputedStyle: (el: FakeElement) => ({ ...el.style, getPropertyValue: (k: string) => el.style[k] ?? "" }),
  }
  const result = vm.runInNewContext(expression, { document, window })
  return JSON.parse(JSON.stringify(result))
}
