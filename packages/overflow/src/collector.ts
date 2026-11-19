// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// The in-page collector: walks the DOM and returns a layout snapshot. `collectLayout` is self-contained (it uses
// only its argument and browser globals), so its source text can run anywhere a page can run script: Playwright or
// Puppeteer `page.evaluate`, the DevTools console, or a bookmarklet. Keep it that way: no imports, no helpers
// outside the function, no comments inside it (the bookmarklet is built from its text).
import type { Snapshot, SnapshotElement } from "./types.ts"

export interface CollectOptions {
  /** Stop after this many elements (default 20,000); the snapshot is then marked `truncated`. */
  maxElements?: number
  /** Longest text kept per element (default 200 characters). */
  textLimit?: number
  /** Extra title selectors whose lines should be measured (h1-h6, role="heading" and classes containing "title" or "heading" always are). */
  titleSelectors?: string[]
  /** Viewport label written into the snapshot (`mobile`, `desktop`). */
  label?: string
  /** Keep the query string and hash in `url` (default false: they often carry tokens). */
  fullUrl?: boolean
}

/** Measures the current page. Runs in a browser; see the README for the ways to call it. */
export function collectLayout(options?: CollectOptions): Snapshot {
  const o = options || {}
  const maxElements = typeof o.maxElements === "number" && o.maxElements > 0 ? Math.floor(o.maxElements) : 20000
  const textLimit = typeof o.textLimit === "number" && o.textLimit > 3 ? Math.floor(o.textLimit) : 200
  const titleSel = Array.isArray(o.titleSelectors) ? o.titleSelectors.join(",") : ""
  const doc = document
  const win = window
  const root = doc.documentElement
  const scroller = doc.scrollingElement || root
  const sx = win.scrollX || 0
  const sy = win.scrollY || 0
  const skip: Record<string, number> = { script: 1, style: 1, head: 1, meta: 1, link: 1, noscript: 1, template: 1, title: 1, base: 1 }
  const leaf: Record<string, number> = { svg: 1, math: 1, iframe: 1, video: 1, audio: 1, canvas: 1, img: 1, select: 1, textarea: 1, input: 1 }
  const r2 = (n: number) => Math.round(n * 100) / 100
  const squash = (s: string) => {
    const t = s.replace(/\s+/g, " ").trim()
    return t.length > textLimit ? t.slice(0, textLimit - 3) + "..." : t
  }
  const esc = (s: string) => (win.CSS && win.CSS.escape ? win.CSS.escape(s) : s.replace(/[^A-Za-z0-9_-]/g, (c) => "\\" + c))
  const px = (v: string) => {
    const n = parseFloat(v)
    return Number.isFinite(n) ? n : 0
  }
  const ov = (v: string): SnapshotElement["overflowX"] => (v === "hidden" || v === "clip" || v === "scroll" || v === "auto" ? v : v === "overlay" ? "auto" : "visible")
  const measureLines = (el: Element, lh: number): string[] | undefined => {
    const range = doc.createRange()
    const tops: number[] = []
    const words: string[][] = []
    let count = 0
    const visit = (node: Node) => {
      const kids = node.childNodes
      for (let k = 0; k < kids.length; k++) {
        const ch = kids[k]!
        if (ch.nodeType === 3) {
          const t = ch.nodeValue || ""
          const re = /\S+/g
          let m: RegExpExecArray | null
          while ((m = re.exec(t)) !== null && count < 300) {
            count++
            range.setStart(ch, m.index)
            range.setEnd(ch, m.index + m[0].length)
            const rects = range.getClientRects()
            let placed = false
            for (let q = 0; q < rects.length; q++) {
              const r = rects[q]!
              if (r.width === 0 && r.height === 0) continue
              let li = -1
              for (let z = 0; z < tops.length; z++) if (Math.abs(tops[z]! - r.top) < lh / 2) li = z
              if (li === -1) {
                tops.push(r.top)
                words.push([])
                li = tops.length - 1
              }
              if (!placed) {
                words[li]!.push(m[0])
                placed = true
              }
            }
          }
        } else if (ch.nodeType === 1) visit(ch)
      }
    }
    try {
      visit(el)
    } catch {
      return undefined
    }
    if (tops.length === 0) return undefined
    return tops.map((t, z) => [t, z] as const).sort((a, b) => a[0] - b[0]).map((p) => words[p[1]]!.join(" "))
  }

  const elements: SnapshotElement[] = []
  const sels: string[] = []
  let truncated = false
  const stack: [Element, number | null, number, boolean][] = [[root, null, 1, false]]
  while (stack.length > 0) {
    const [el, parent, nth, many] = stack.pop()!
    const tag = el.tagName.toLowerCase()
    if (skip[tag]) continue
    if (elements.length >= maxElements) {
      truncated = true
      break
    }
    const cs = win.getComputedStyle(el)
    if (cs.display === "none") continue
    const index = elements.length
    const id = el.getAttribute("id") || ""
    const classAttr = el.getAttribute("class") || ""
    const classes = classAttr.split(/\s+/).filter(Boolean)
    let part = tag + classes.slice(0, 3).map((c) => "." + esc(c)).join("") + (many ? ":nth-of-type(" + nth + ")" : "")
    let sel = parent === null ? part : sels[parent] + " > " + part
    if (id && /^[A-Za-z][\w-]*$/.test(id) && doc.querySelectorAll("#" + esc(id)).length === 1) sel = tag + "#" + esc(id)
    sels.push(sel)
    const attrs: Record<string, string> = {}
    let na = 0
    for (let k = 0; k < el.attributes.length && na < 20; k++) {
      const a = el.attributes[k]!
      if (a.name === "id" || a.name === "class" || a.name === "style") continue
      attrs[a.name] = a.value.length > 100 ? a.value.slice(0, 100) : a.value
      na++
    }
    const b = el.getBoundingClientRect()
    const fontSize = px(cs.fontSize)
    const lineHeight = cs.lineHeight === "normal" ? r2(fontSize * 1.2) : px(cs.lineHeight)
    const overflowX = ov(cs.overflowX)
    const overflowY = ov(cs.overflowY)
    const textOverflow = cs.textOverflow || "clip"
    const isTitle = /^h[1-6]$/.test(tag) || attrs["role"] === "heading" || /title|heading/i.test(classAttr) || (titleSel !== "" && el.matches(titleSel))
    let text = ""
    if (isTitle || overflowX !== "visible" || overflowY !== "visible") text = squash(el.textContent || "")
    else {
      let own = ""
      for (let k = 0; k < el.childNodes.length; k++) if (el.childNodes[k]!.nodeType === 3) own += el.childNodes[k]!.nodeValue
      text = squash(own)
    }
    const e: SnapshotElement = {
      parent,
      tag,
      selector: sel,
      rect: { x: r2(b.left + sx), y: r2(b.top + sy), width: r2(b.width), height: r2(b.height) },
      scrollWidth: el.scrollWidth,
      scrollHeight: el.scrollHeight,
      clientWidth: el.clientWidth,
      clientHeight: el.clientHeight,
      overflowX,
      overflowY,
      whiteSpace: cs.whiteSpace || "normal",
      fontSize,
      lineHeight,
      display: cs.display,
      position: cs.position,
      direction: cs.direction === "rtl" ? "rtl" : "ltr",
    }
    if (id) e.id = id
    if (classes.length > 0) e.classes = classes
    if (na > 0) e.attrs = attrs
    if (many) e.nth = nth
    if (cs.visibility !== "visible") e.visible = false
    if (textOverflow !== "clip") e.textOverflow = textOverflow
    const clamp = parseInt(cs.getPropertyValue("-webkit-line-clamp"), 10)
    if (clamp > 0) e.lineClamp = clamp
    const wrap = cs.getPropertyValue("text-wrap-style") || cs.getPropertyValue("text-wrap")
    if (wrap) e.textWrap = wrap.split(" ")[0]!
    const span = (el as HTMLTableCellElement).colSpan
    if (typeof span === "number" && span > 1) e.colSpan = span
    if (text) e.text = text
    if (isTitle && text) {
      const lines = measureLines(el, lineHeight || fontSize || 1)
      if (lines) e.lines = lines
    }
    elements.push(e)
    if (leaf[tag]) continue
    const kids = el.children
    const seen: Record<string, number> = {}
    const total: Record<string, number> = {}
    for (let k = 0; k < kids.length; k++) {
      const t = kids[k]!.tagName
      total[t] = (total[t] || 0) + 1
    }
    const push: [Element, number | null, number, boolean][] = []
    for (let k = 0; k < kids.length; k++) {
      const t = kids[k]!.tagName
      seen[t] = (seen[t] || 0) + 1
      push.push([kids[k]!, index, seen[t]!, total[t]! > 1])
    }
    for (let k = push.length - 1; k >= 0; k--) stack.push(push[k]!)
  }
  const loc = win.location
  const snap: Snapshot = {
    overflow: 1,
    url: o.fullUrl ? loc.href : loc.origin + loc.pathname,
    takenAt: new Date().toISOString(),
    viewport: { width: win.innerWidth, height: win.innerHeight },
    document: { scrollWidth: scroller.scrollWidth, scrollHeight: scroller.scrollHeight, clientWidth: scroller.clientWidth, clientHeight: scroller.clientHeight },
    direction: win.getComputedStyle(root).direction === "rtl" ? "rtl" : "ltr",
    elements,
  }
  if (typeof o.label === "string" && o.label) snap.viewport.label = o.label
  if (truncated) snap.truncated = true
  return snap
}

/** The collector's JavaScript source: a function expression taking `CollectOptions`. */
export const COLLECTOR_SOURCE: string = collectLayout
  .toString()
  .replace(/^(async\s+)?function\s+collectLayout/, "function collectLayout")
  .replace(/\n[ \t]+/g, "\n")

/** A JavaScript expression that collects and evaluates to the snapshot: for `page.evaluate(expr)` or the console. */
export function collectorExpression(options: CollectOptions = {}): string {
  return `(${COLLECTOR_SOURCE})(${JSON.stringify(options)})`
}

/** A `javascript:` URL for a bookmark: collects the current page and downloads `overflow-<label>.json`. */
export function bookmarklet(options: CollectOptions = {}): string {
  const name = `overflow-${(options.label ?? "snapshot").replace(/[^\w-]+/g, "-")}.json`
  const body =
    `(function(){var s=${collectorExpression(options)};` +
    `var a=document.createElement("a");a.href=URL.createObjectURL(new Blob([JSON.stringify(s)],{type:"application/json"}));` +
    `a.download=${JSON.stringify(name)};document.body.appendChild(a);a.click();a.remove();` +
    `console.log("overflow: saved "+s.elements.length+" elements to ${name}")})()`
  return "javascript:" + encodeURIComponent(body)
}
