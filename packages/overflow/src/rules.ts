// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// The rules. Each one reads the snapshot through a `Context` and returns findings; none of them touch a browser, so
// every rule is tested with hand-built snapshots.
import { matches, parseSelector, type SelectorList } from "./selector.ts"
import type { Finding, ResolvedConfig, RuleId, Severity, Snapshot, SnapshotElement } from "./types.ts"

/** A finding plus the element index it is about, for stable ordering. */
export interface RawFinding extends Finding {
  index: number
}

export class Context {
  readonly snapshot: Snapshot
  readonly els: readonly SnapshotElement[]
  readonly cfg: ResolvedConfig
  readonly children: number[][]
  /** Ignored by config, directly or through an ancestor. */
  readonly ignored: boolean[]
  private readonly lists = new Map<string, SelectorList>()

  constructor(snapshot: Snapshot, cfg: ResolvedConfig) {
    this.snapshot = snapshot
    this.els = snapshot.elements
    this.cfg = cfg
    this.children = this.els.map(() => [])
    this.ignored = new Array<boolean>(this.els.length).fill(false)
    const ignore = cfg.ignore.length > 0 ? this.list(cfg.ignore) : undefined
    this.els.forEach((e, i) => {
      if (e.parent !== null) this.children[e.parent]!.push(i)
      this.ignored[i] = (e.parent !== null && this.ignored[e.parent]!) || (ignore !== undefined && matches(ignore, this.els, i))
    })
  }

  /** One parsed list for a set of selectors (they were validated with the config). */
  list(selectors: readonly string[]): SelectorList {
    const key = selectors.join("\u0000")
    let l = this.lists.get(key)
    if (l === undefined) {
      const parsed = selectors.map((s) => parseSelector(s))
      l = { source: selectors.join(", "), complexes: parsed.flatMap((p) => p.complexes) }
      this.lists.set(key, l)
    }
    return l
  }

  matches(selectors: readonly string[], i: number): boolean {
    return selectors.length > 0 && matches(this.list(selectors), this.els, i)
  }

  /** Not ignored, not `visibility: hidden`, and has an area. */
  shown(i: number): boolean {
    const e = this.els[i]!
    return !this.ignored[i] && e.visible !== false && e.rect.width > 0 && e.rect.height > 0
  }

  dir(i: number): "ltr" | "rtl" {
    return this.els[i]!.direction ?? this.snapshot.direction ?? "ltr"
  }

  severity(rule: RuleId): Severity | "off" {
    return this.cfg.rules[rule]
  }
}

const PAGE_TAGS = new Set(["html", "body"])
const SCROLLS = new Set(["auto", "scroll"])
const CLIPS = new Set(["hidden", "clip"])
const round = (n: number): number => Math.round(n * 100) / 100

/** Severity for a finding that is likely intentional: info, unless the rule is off. */
const soft = (s: Severity | "off"): Severity | "off" => (s === "off" ? "off" : "info")

// ---------------------------------------------------------------------------------------------------------------
// inner-scrollbar

export function innerScrollbar(ctx: Context): RawFinding[] {
  const sev = ctx.severity("inner-scrollbar")
  if (sev === "off") return []
  const tol = ctx.cfg.tolerance.overflow
  const out: RawFinding[] = []
  ctx.els.forEach((e, i) => {
    if (PAGE_TAGS.has(e.tag) || !ctx.shown(i) || ctx.matches(ctx.cfg.allowScroll, i)) return
    const x = SCROLLS.has(e.overflowX) && e.scrollWidth - e.clientWidth > tol
    const y = SCROLLS.has(e.overflowY) && e.scrollHeight - e.clientHeight > tol
    const measured = {
      axis: x && y ? "both" : x ? "x" : "y",
      scrollWidth: e.scrollWidth,
      clientWidth: e.clientWidth,
      scrollHeight: e.scrollHeight,
      clientHeight: e.clientHeight,
      overflowX: e.overflowX,
      overflowY: e.overflowY,
    }
    if (x || y) {
      const parts: string[] = []
      if (x) parts.push(`content ${e.scrollWidth} px wide in a ${e.clientWidth} px box`)
      if (y) parts.push(`content ${e.scrollHeight} px tall in a ${e.clientHeight} px box`)
      out.push({
        index: i,
        rule: "inner-scrollbar",
        severity: sev,
        selector: e.selector,
        message: `scrolls inside the page: ${parts.join(", ")}`,
        measured,
        hint: "Let the page scroll instead (drop the fixed height or max-height, or overflow: auto), or add the selector to allowScroll if this scroll box is intended.",
      })
    } else if (e.overflowX === "scroll" || e.overflowY === "scroll") {
      out.push({
        index: i,
        rule: "inner-scrollbar",
        severity: soft(sev) as Severity,
        selector: e.selector,
        message: "overflow: scroll with nothing to scroll; systems with classic scrollbars show an empty scrollbar track",
        measured: { ...measured, axis: e.overflowX === "scroll" && e.overflowY === "scroll" ? "both" : e.overflowX === "scroll" ? "x" : "y" },
        hint: "Use overflow: auto, which shows a scrollbar only when there is something to scroll.",
      })
    }
  })
  return out
}

// ---------------------------------------------------------------------------------------------------------------
// page-overflow-x

export function pageOverflowX(ctx: Context): RawFinding[] {
  const sev = ctx.severity("page-overflow-x")
  if (sev === "off") return []
  const doc = ctx.snapshot.document
  const tol = ctx.cfg.tolerance.page
  const over = doc.scrollWidth - doc.clientWidth
  if (over <= tol) return []
  const rtl = (ctx.snapshot.direction ?? "ltr") === "rtl"

  // Elements inside a box that clips or scrolls horizontally can't widen the page; fixed elements never do.
  const contained = new Array<boolean>(ctx.els.length).fill(false)
  const overshoot = new Array<number>(ctx.els.length).fill(0)
  ctx.els.forEach((e, i) => {
    const p = e.parent
    if (p !== null) {
      const pe = ctx.els[p]!
      contained[i] = contained[p]! || (!PAGE_TAGS.has(pe.tag) && pe.overflowX !== "visible") || pe.position === "fixed"
    }
    if (contained[i] || ctx.ignored[i] || e.position === "fixed" || e.rect.width === 0 || PAGE_TAGS.has(e.tag)) return
    overshoot[i] = rtl ? -e.rect.x : e.rect.x + e.rect.width - doc.clientWidth
  })
  // Name the outermost elements that stick out: their parent fits, so they are where the width comes from.
  const culprits: number[] = []
  overshoot.forEach((o, i) => {
    if (o <= tol) return
    const p = ctx.els[i]!.parent
    if (p !== null && overshoot[p]! > tol) return
    culprits.push(i)
  })
  culprits.sort((a, b) => overshoot[b]! - overshoot[a]! || a - b)
  const shown = culprits.slice(0, ctx.cfg.maxCulprits)

  const rootIndex = ctx.els.findIndex((e) => e.tag === "html")
  const out: RawFinding[] = [
    {
      index: rootIndex === -1 ? -1 : rootIndex,
      rule: "page-overflow-x",
      severity: sev,
      selector: "html",
      message: `the page is ${round(over)} px wider than the viewport and scrolls sideways` +
        (culprits.length === 0 ? "; no single element found (check pseudo-elements, margins and transforms)" :
          `; ${culprits.length} element${culprits.length === 1 ? "" : "s"} stick${culprits.length === 1 ? "s" : ""} out`),
      measured: { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, overflow: round(over), culprits: culprits.length },
      hint: "Fix the elements named below; overflow-x: hidden on body hides the symptom and can break position: sticky.",
    },
  ]
  for (const i of shown) {
    const e = ctx.els[i]!
    out.push({
      // Sorted with the page finding (stable sort), so culprits stay together, largest first.
      index: out[0]!.index,
      rule: "page-overflow-x",
      severity: sev,
      selector: e.selector,
      message: `sticks out ${round(overshoot[i]!)} px past the ${rtl ? "left" : "right"} edge of the viewport`,
      measured: { overshoot: round(overshoot[i]!), left: round(e.rect.x), right: round(e.rect.x + e.rect.width), width: round(e.rect.width), viewportWidth: doc.clientWidth },
      hint: "Common causes: a fixed width or min-width, 100vw (it includes the scrollbar), long unbroken text or URLs (overflow-wrap: anywhere), wide images or tables without max-width: 100%.",
    })
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------------
// column-misaligned

const ROW_TAGS = new Set(["tr", "li"])
const ROW_ROLES = new Set(["row", "listitem"])

interface Row {
  index: number
  cells: number[]
}

export function columnMisaligned(ctx: Context): RawFinding[] {
  const sev = ctx.severity("column-misaligned")
  if (sev === "off") return []
  const tol = ctx.cfg.tolerance.column

  // Collect candidate row groups: rows of one table, items of one list, or same-looking siblings.
  const groups = new Map<number, number[]>()
  const add = (key: number, i: number) => {
    const g = groups.get(key)
    if (g) g.push(i)
    else groups.set(key, [i])
  }
  const isRowLike = (e: SnapshotElement) => ROW_TAGS.has(e.tag) || ROW_ROLES.has(e.attrs?.role ?? "")
  ctx.els.forEach((e, i) => {
    if (!isRowLike(e) || e.parent === null) return
    let key = e.parent
    if (e.tag === "tr") {
      // Rows of one table share columns across thead, tbody and tfoot.
      for (let p: number | null = e.parent; p !== null; p = ctx.els[p]!.parent) {
        if (ctx.els[p]!.tag === "table" || ctx.els[p]!.attrs?.role === "table" || ctx.els[p]!.attrs?.role === "grid") {
          key = p
          break
        }
      }
    }
    add(key, i)
  })
  // Same tag and classes under one parent, each with two or more children: a list built from divs.
  ctx.children.forEach((kids, p) => {
    if (groups.has(p)) return
    const bySig = new Map<string, number[]>()
    for (const k of kids) {
      const e = ctx.els[k]!
      if (isRowLike(e) || ctx.children[k]!.length < 2) continue
      const sig = `${e.tag}.${[...(e.classes ?? [])].sort().join(".")}`
      const g = bySig.get(sig)
      if (g) g.push(k)
      else bySig.set(sig, [k])
    }
    // Only the largest family, so a list's header row of another class doesn't start its own group.
    let best: number[] | undefined
    for (const g of bySig.values()) if (g.length >= ctx.cfg.minRows && (best === undefined || g.length > best.length)) best = g
    if (best) groups.set(-1 - p, best)
  })

  const out: RawFinding[] = []
  for (const [key, members] of groups) {
    const rtl = ctx.dir(members[0]!) === "rtl"
    const start = (i: number) => (rtl ? ctx.els[i]!.rect.x + ctx.els[i]!.rect.width : ctx.els[i]!.rect.x)
    const rows: Row[] = []
    for (const r of members) {
      if (!ctx.shown(r)) continue
      const cells = ctx.children[r]!.filter((c) => ctx.shown(c))
      if (cells.length < 2 || cells.some((c) => (ctx.els[c]!.colSpan ?? 1) > 1)) continue
      if (!horizontal(ctx, cells, rtl)) continue
      rows.push({ index: r, cells })
    }
    if (rows.length < ctx.cfg.minRows) continue
    // Rows side by side (a card grid) aren't one list: keep the rows that start where most rows start.
    const startEdge = median(rows.map((r) => start(r.index)))
    const aligned = rows.filter((r) => Math.abs(start(r.index) - startEdge) <= tol)
    // Compare rows with the most common number of cells.
    const counts = new Map<number, number>()
    for (const r of aligned) counts.set(r.cells.length, (counts.get(r.cells.length) ?? 0) + 1)
    let n = 0
    let most = 0
    for (const [len, c] of counts) if (c > most || (c === most && len > n)) [n, most] = [len, c]
    const same = aligned.filter((r) => r.cells.length === n)
    if (same.length < ctx.cfg.minRows) continue

    const groupIndex = key >= 0 ? key : -1 - key
    const groupSelector = key >= 0 ? ctx.els[key]!.selector : ctx.els[groupIndex]!.selector
    for (let col = 0; col < n; col++) {
      const edges = same.map((r) => start(r.cells[col]!))
      const mid = median(edges)
      const off = same.map((r, k) => ({ r, d: edges[k]! - mid })).filter((x) => Math.abs(x.d) > tol)
      if (off.length === 0) continue
      const worst = off.reduce((a, b) => (Math.abs(b.d) > Math.abs(a.d) ? b : a))
      const cell = worst.r.cells[col]!
      out.push({
        index: cell,
        rule: "column-misaligned",
        severity: sev,
        selector: ctx.els[cell]!.selector,
        message: `column ${col + 1} of ${same.length} rows in ${groupSelector}: ${off.length} row${off.length === 1 ? "" : "s"} start${off.length === 1 ? "s" : ""} up to ${round(Math.abs(worst.d))} px from the others`,
        measured: {
          group: groupSelector,
          column: col + 1,
          rows: same.length,
          misaligned: off.length,
          expected: round(mid),
          actual: round(edges[same.indexOf(worst.r)]!),
          offset: round(worst.d),
          edge: rtl ? "right" : "left",
        },
        hint: "Give the columns shared widths: a table, CSS grid with grid-template-columns (or subgrid), or fixed cell widths, instead of content-sized flex items.",
      })
    }
  }
  return out
}

/** Cells laid out side by side on one line, in reading order. Stacked cells (a phone layout) are not a row. */
function horizontal(ctx: Context, cells: number[], rtl: boolean): boolean {
  const first = ctx.els[cells[0]!]!.rect
  let prev = rtl ? first.x + first.width : first.x
  for (let k = 1; k < cells.length; k++) {
    const r = ctx.els[cells[k]!]!.rect
    if (r.y >= first.y + first.height || r.y + r.height <= first.y) return false
    const edge = rtl ? r.x + r.width : r.x
    if (rtl ? edge >= prev : edge <= prev) return false
    prev = edge
  }
  return true
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

// ---------------------------------------------------------------------------------------------------------------
// title-wraps and title-widow

const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"])

export function titles(ctx: Context): RawFinding[] {
  const wrapSev = ctx.severity("title-wraps")
  const widowSev = ctx.severity("title-widow")
  if (wrapSev === "off" && widowSev === "off") return []
  const isTitle = ctx.els.map((e, i) => HEADINGS.has(e.tag) || e.attrs?.role === "heading" || ctx.matches(ctx.cfg.titleSelectors, i))
  const out: RawFinding[] = []
  ctx.els.forEach((e, i) => {
    if (!isTitle[i] || !ctx.shown(i)) return
    for (let p = e.parent; p !== null; p = ctx.els[p]!.parent) if (isTitle[p]) return // the outer title is checked
    const text = (e.text ?? (e.lines ?? []).join(" ")).trim()
    if (text === "") return
    const measuredLines = e.lines !== undefined && e.lines.length > 0
    const lineCount = measuredLines ? e.lines!.length : e.lineHeight > 0 ? Math.max(1, Math.round(e.rect.height / e.lineHeight)) : 1
    const max = ctx.cfg.maxTitleLines
    if (wrapSev !== "off" && lineCount > max) {
      out.push({
        index: i,
        rule: "title-wraps",
        severity: wrapSev,
        selector: e.selector,
        message: `title wraps to ${lineCount} lines (limit ${max})${measuredLines ? "" : ", estimated from its height"}: "${short(text)}"`,
        measured: { lines: lineCount, maxLines: max, width: round(e.rect.width), fontSize: e.fontSize, lineHeight: round(e.lineHeight), estimated: !measuredLines },
        hint: "Shorten the title, give it more width, or lower the font size at this viewport (clamp() scales it with the viewport).",
      })
    }
    if (widowSev !== "off" && measuredLines && e.lines!.length >= 2 && e.textWrap !== "balance" && e.textWrap !== "pretty") {
      const last = e.lines![e.lines!.length - 1]!.trim().split(/\s+/).filter(Boolean)
      const words = text.split(/\s+/).filter(Boolean).length
      if (last.length === 1 && words >= 3) {
        out.push({
          index: i,
          rule: "title-widow",
          severity: widowSev,
          selector: e.selector,
          message: `title leaves one word, "${short(last[0]!, 30)}", alone on its last line: "${short(text)}"`,
          measured: { lines: e.lines!.length, lastLine: last[0]!, width: round(e.rect.width) },
          hint: "text-wrap: balance evens out the lines of short titles (or join the last two words with a non-breaking space).",
        })
      }
    }
  })
  return out
}

function short(text: string, max = 60): string {
  return text.length > max ? text.slice(0, max - 3) + "..." : text
}

// ---------------------------------------------------------------------------------------------------------------
// text-clipped

export function textClipped(ctx: Context): RawFinding[] {
  const sev = ctx.severity("text-clipped")
  if (sev === "off") return []
  const tol = ctx.cfg.tolerance.overflow
  const out: RawFinding[] = []
  ctx.els.forEach((e, i) => {
    if (PAGE_TAGS.has(e.tag) || !ctx.shown(i)) return
    const text = (e.text ?? "").trim()
    if (text === "") return
    const x = CLIPS.has(e.overflowX) && e.scrollWidth - e.clientWidth > tol
    const y = CLIPS.has(e.overflowY) && e.scrollHeight - e.clientHeight > tol
    if (!x && !y) return
    const ellipsis = x && e.textOverflow === "ellipsis"
    const clamped = y && e.lineClamp !== undefined
    const intentional = (!x || ellipsis) && (!y || clamped)
    const parts: string[] = []
    if (x) parts.push(`${e.scrollWidth - e.clientWidth} px cut off on the ${ctx.dir(i) === "rtl" ? "left" : "right"}${ellipsis ? " (with an ellipsis)" : ""}`)
    if (y) parts.push(`${e.scrollHeight - e.clientHeight} px cut off at the bottom${clamped ? ` (clamped to ${e.lineClamp} lines)` : ""}`)
    out.push({
      index: i,
      rule: "text-clipped",
      severity: intentional ? (soft(sev) as Severity) : sev,
      selector: e.selector,
      message: `${intentional ? "truncated" : "text is clipped"}: ${parts.join(", ")}: "${short(text)}"`,
      measured: {
        axis: x && y ? "both" : x ? "x" : "y",
        scrollWidth: e.scrollWidth,
        clientWidth: e.clientWidth,
        scrollHeight: e.scrollHeight,
        clientHeight: e.clientHeight,
        whiteSpace: e.whiteSpace,
        intentional,
      },
      hint: intentional
        ? "Truncation looks deliberate; make sure the full text is reachable (a title attribute, a tooltip or a detail view)."
        : "Let the box grow with its text (drop the fixed height or width), or truncate on purpose with text-overflow: ellipsis or line-clamp.",
    })
  })
  return out
}

export const RULES: readonly ((ctx: Context) => RawFinding[])[] = [pageOverflowX, innerScrollbar, columnMisaligned, titles, textClipped]
