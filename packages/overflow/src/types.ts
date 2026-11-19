// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// The shapes shared by the collector, the rule engine and the formatters. A snapshot is plain JSON, so a page can be
// measured once in a browser and checked anywhere (Node, CI) without one.

/** A box in document coordinates (CSS pixels): the element's border box plus the page scroll at capture time. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export type OverflowValue = "visible" | "hidden" | "clip" | "scroll" | "auto"

/** One element as the collector measured it. */
export interface SnapshotElement {
  /** Index of the parent element in `elements`, or `null` for the root. Parents always come before children. */
  parent: number | null
  /** Lower-case tag name (`div`, `h2`, `td`). */
  tag: string
  /** A CSS selector path that finds this element on the page, for reports and for copying into `ignore`. */
  selector: string
  /** The element's `id` attribute, if any. */
  id?: string
  /** Class names. */
  classes?: string[]
  /** Other attributes (role, data-*, aria-*), values shortened. Used to match ignore and title selectors. */
  attrs?: Record<string, string>
  /** 1-based position among siblings with the same tag, for `:nth-of-type(n)`. */
  nth?: number
  rect: Rect
  scrollWidth: number
  scrollHeight: number
  clientWidth: number
  clientHeight: number
  overflowX: OverflowValue
  overflowY: OverflowValue
  /** Computed `white-space` (`normal`, `nowrap`, `pre`...). */
  whiteSpace: string
  /** Computed `font-size` in px. */
  fontSize: number
  /** Computed `line-height` in px (`normal` is recorded as 1.2 × font size). */
  lineHeight: number
  /** Computed `display`; elements with `display: none` are never recorded. */
  display?: string
  /** Computed `position`; fixed elements don't make the page scroll. */
  position?: string
  /** `ltr` or `rtl`. Default `ltr`. */
  direction?: "ltr" | "rtl"
  /** `false` for `visibility: hidden` or `collapse`. Default `true`. */
  visible?: boolean
  /** Computed `text-overflow` (`clip` or `ellipsis`). */
  textOverflow?: string
  /** Computed `-webkit-line-clamp` as a number, if set. */
  lineClamp?: number
  /** Computed `text-wrap` (`wrap`, `balance`, `pretty`). */
  textWrap?: string
  /** `colSpan` for table cells above 1. */
  colSpan?: number
  /** Text: the full text for headings, titles and clipping boxes; the element's own text otherwise. Shortened. */
  text?: string
  /** For headings and titles: the words on each rendered line, as measured in the browser. */
  lines?: string[]
}

export interface Snapshot {
  /** Snapshot format version. Always 1. */
  overflow: 1
  url?: string
  /** When the snapshot was taken (ISO 8601), informational only. */
  takenAt?: string
  viewport: { width: number; height: number; label?: string }
  /** The document scroller's sizes (`document.scrollingElement`). */
  document: { scrollWidth: number; scrollHeight: number; clientWidth: number; clientHeight: number }
  /** Page direction. Default `ltr`. */
  direction?: "ltr" | "rtl"
  /** `true` when the collector stopped at its element limit. */
  truncated?: boolean
  elements: SnapshotElement[]
}

export type Severity = "info" | "warning" | "error"

export const RULE_IDS = ["inner-scrollbar", "page-overflow-x", "column-misaligned", "title-wraps", "title-widow", "text-clipped"] as const
export type RuleId = (typeof RULE_IDS)[number]

export interface Finding {
  rule: RuleId
  severity: Severity
  selector: string
  message: string
  /** The numbers the finding is based on, in CSS pixels or lines. */
  measured: Record<string, number | string | boolean>
  /** A usual fix, in one sentence. */
  hint?: string
}

export interface Report {
  overflow: 1
  url?: string
  viewport: { width: number; height: number; label?: string }
  /** Echoes `snapshot.truncated`: findings may be missing for elements after the limit. */
  truncated: boolean
  elements: number
  counts: Record<Severity, number>
  findings: Finding[]
}

/** Settings for a check. Every field is optional; see DEFAULT_CONFIG. */
export interface Config {
  /** Label for the viewport in reports (`mobile`, `1280 wide`). Overrides the snapshot's label. */
  viewportLabel?: string
  /** Elements matching these selectors (and everything inside them) are skipped by every rule. */
  ignore?: string[]
  /** Scroll boxes matching these selectors are intended (code blocks, carousels, data grids). */
  allowScroll?: string[]
  /** Extra selectors treated as titles besides h1-h6 and role="heading" (for example `.card-title`). */
  titleSelectors?: string[]
  /** Titles may take this many lines before `title-wraps` reports them. */
  maxTitleLines?: number
  tolerance?: {
    /** Pixels a column's start edge may differ between rows. */
    column?: number
    /** Pixels of overflow ignored before a box counts as scrolling or clipped (sub-pixel rounding). */
    overflow?: number
    /** Pixels the page may be wider than the viewport. */
    page?: number
  }
  /** At most this many elements are named as the cause of horizontal page overflow. */
  maxCulprits?: number
  /** Rows needed before a list or table is checked for column alignment. */
  minRows?: number
  /** Change a rule's severity, or turn it off. */
  rules?: Partial<Record<RuleId, Severity | "off">>
  /** Lowest severity that makes `overflow check` exit 1. `never` always exits 0. */
  failOn?: Severity | "never"
}

/** Config with every default filled in. */
export interface ResolvedConfig {
  viewportLabel: string | undefined
  ignore: string[]
  allowScroll: string[]
  titleSelectors: string[]
  maxTitleLines: number
  tolerance: { column: number; overflow: number; page: number }
  maxCulprits: number
  minRows: number
  rules: Record<RuleId, Severity | "off">
  failOn: Severity | "never"
}
