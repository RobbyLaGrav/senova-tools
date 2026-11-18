// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// A scanned document: its text, line positions, sentence boundaries and the ignore directives written in it.
// Rules see one of these and report character offsets; the checker turns offsets into line and column.

/** Rule ids an ignore directive names, or "all" when it names none. */
type Scope = Set<string> | "all"

export interface Position {
  /** 1-based line. */
  line: number
  /** 1-based column. */
  column: number
}

export interface Span {
  start: number
  end: number
}

const DIRECTIVE = /honest-ignore-(next-line|line|file|start|end)\b([^\n]*)/

/** Ids after a directive, up to an optional ` -- reason` or the end of an HTML or block comment. */
function parseScope(rest: string): Scope {
  const head = rest.split(/\s--\s|-->|\*\//)[0] ?? ""
  const ids = head.match(/[a-z][a-z0-9-]*[a-z0-9]/gi) ?? []
  return ids.length ? new Set(ids.map((x) => x.toLowerCase())) : "all"
}

const covers = (scope: Scope | undefined, rule: string): boolean => scope !== undefined && (scope === "all" || scope.has(rule))

const merge = (a: Scope | undefined, b: Scope): Scope => {
  if (a === undefined) return b
  if (a === "all" || b === "all") return "all"
  return new Set([...a, ...b])
}

export class Document {
  readonly file: string
  readonly text: string
  private readonly lineStarts: number[] = [0]
  private readonly ignoredLines = new Map<number, Scope>()
  private fileScope: Scope | undefined
  private sentenceCache: Span[] | undefined

  /** "prose" splits sentences at punctuation and blank lines; "code" also treats every line break as a boundary. */
  readonly mode: "prose" | "code"

  constructor(text: string, file = "<text>", mode: "prose" | "code" = "prose") {
    this.file = file
    this.text = text
    this.mode = mode
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) this.lineStarts.push(i + 1)
    this.readDirectives()
  }

  private readDirectives(): void {
    const lines = this.text.split("\n")
    const open: Scope[] = []
    lines.forEach((raw, i) => {
      const line = i + 1
      for (const scope of open) this.ignore(line, scope)
      const m = DIRECTIVE.exec(raw)
      if (!m) return
      const scope = parseScope(m[2] ?? "")
      if (m[1] === "line") this.ignore(line, scope)
      else if (m[1] === "next-line") this.ignore(line + 1, scope)
      else if (m[1] === "file") this.fileScope = merge(this.fileScope, scope)
      else if (m[1] === "start") open.push(scope)
      else open.pop()
    })
  }

  private ignore(line: number, scope: Scope): void {
    this.ignoredLines.set(line, merge(this.ignoredLines.get(line), scope))
  }

  /** True when a directive switches `rule` off at this line. */
  isIgnored(line: number, rule: string): boolean {
    return covers(this.fileScope, rule) || covers(this.ignoredLines.get(line), rule)
  }

  /** True when `honest-ignore-file` covers `rule` for the whole file. */
  isFileIgnored(rule: string): boolean {
    return covers(this.fileScope, rule)
  }

  /** Line and column of a character offset. */
  position(index: number): Position {
    let lo = 0
    let hi = this.lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if ((this.lineStarts[mid] ?? 0) <= index) lo = mid
      else hi = mid - 1
    }
    return { line: lo + 1, column: index - (this.lineStarts[lo] ?? 0) + 1 }
  }

  /**
   * Sentences, approximately: text split at ". ", "! ", "? " (not decimal points), blank lines and line breaks before
   * list items, headings and table rows; in "code" mode, at every line break. Good enough to keep a negation or a
   * label in the same sentence as the claim it qualifies.
   */
  sentences(): readonly Span[] {
    if (this.sentenceCache) return this.sentenceCache
    const spans: Span[] = []
    const boundary =
      this.mode === "code"
        ? /[.!?]["'`)\]]*(?=\s|$)|\n/g
        : /[.!?]["'`)\]]*(?=\s|$)|\n[ \t]*\n|\n(?=[ \t]*(?:[-*+] |\d+\. |#|\||<))/g
    let start = 0
    for (const m of this.text.matchAll(boundary)) {
      const end = (m.index ?? 0) + m[0].length
      if (end > start) spans.push({ start, end })
      start = end
    }
    if (start < this.text.length) spans.push({ start, end: this.text.length })
    this.sentenceCache = spans
    return spans
  }

  /** The sentence that contains a character offset. */
  sentenceAt(index: number): Span {
    const spans = this.sentences()
    let lo = 0
    let hi = spans.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if ((spans[mid]?.start ?? 0) <= index) lo = mid
      else hi = mid - 1
    }
    return spans[lo] ?? { start: 0, end: this.text.length }
  }
}
