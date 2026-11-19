// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// A small CSS selector matcher over snapshot elements, so `ignore`, `allowScroll` and `titleSelectors` work in Node
// without a browser. It supports what the collector's selector paths use plus the usual hand-written forms:
// `tag`, `*`, `#id`, `.class`, `[attr]`, `[attr=v]`, `[attr~=v]`, `[attr^=v]`, `[attr$=v]`, `[attr*=v]`,
// `:nth-of-type(n)`, the descendant (space) and child (`>`) combinators, and comma lists. Anything else is refused
// with a clear error rather than silently matching nothing.
import { InputError } from "./snapshot.ts"
import type { SnapshotElement } from "./types.ts"

type AttrOp = "" | "=" | "~=" | "^=" | "$=" | "*="
interface Compound {
  tag?: string
  ids: string[]
  classes: string[]
  attrs: { name: string; op: AttrOp; value: string }[]
  nth?: number
}
/** Compounds right to left; `combinators[i]` joins compound i to compound i + 1 (further left). */
interface Complex {
  compounds: Compound[]
  combinators: (" " | ">")[]
}
export interface SelectorList {
  source: string
  complexes: Complex[]
}

const IDENT_START = /[A-Za-z_\-\u0080-￿\\]/

class Parser {
  readonly s: string
  i = 0
  constructor(s: string) {
    this.s = s
  }
  fail(msg: string): never {
    throw new InputError("", `selector "${this.s}": ${msg} at position ${this.i + 1}`)
  }
  peek(): string {
    return this.s[this.i] ?? ""
  }
  skipSpace(): boolean {
    const start = this.i
    while (/\s/.test(this.peek())) this.i++
    return this.i > start
  }
  ident(): string {
    let out = ""
    if (!IDENT_START.test(this.peek())) this.fail("expected a name")
    while (this.i < this.s.length) {
      const c = this.peek()
      if (c === "\\") {
        this.i++
        const hex = /^[0-9a-fA-F]{1,6}/.exec(this.s.slice(this.i))
        if (hex) {
          out += String.fromCodePoint(parseInt(hex[0], 16))
          this.i += hex[0].length
          if (/\s/.test(this.peek())) this.i++
        } else if (this.i < this.s.length) {
          out += this.s[this.i++]
        } else this.fail("dangling backslash")
      } else if (/[A-Za-z0-9_\-\u0080-￿]/.test(c)) {
        out += c
        this.i++
      } else break
    }
    return out
  }
  quoted(): string {
    const q = this.peek()
    this.i++
    let out = ""
    while (this.i < this.s.length && this.peek() !== q) {
      if (this.peek() === "\\") this.i++
      out += this.s[this.i++] ?? ""
    }
    if (this.peek() !== q) this.fail("unclosed quote")
    this.i++
    return out
  }
  compound(): Compound {
    const c: Compound = { ids: [], classes: [], attrs: [] }
    let any = false
    if (this.peek() === "*") {
      this.i++
      any = true
    } else if (IDENT_START.test(this.peek()) && this.peek() !== "\\") {
      c.tag = this.ident().toLowerCase()
      any = true
    }
    for (;;) {
      const ch = this.peek()
      if (ch === "#") {
        this.i++
        c.ids.push(this.ident())
      } else if (ch === ".") {
        this.i++
        c.classes.push(this.ident())
      } else if (ch === "[") {
        this.i++
        this.skipSpace()
        const name = this.ident().toLowerCase()
        this.skipSpace()
        let op: AttrOp = ""
        let value = ""
        const m = /^(=|~=|\^=|\$=|\*=)/.exec(this.s.slice(this.i))
        if (m) {
          op = m[1] as AttrOp
          this.i += op.length
          this.skipSpace()
          value = this.peek() === '"' || this.peek() === "'" ? this.quoted() : this.ident()
          this.skipSpace()
        }
        if (this.peek() !== "]") this.fail(`expected "]" (attribute flags and |= are not supported)`)
        this.i++
        c.attrs.push({ name, op, value })
      } else if (ch === ":") {
        const m = /^:nth-of-type\(\s*(\d+)\s*\)/.exec(this.s.slice(this.i))
        if (!m) this.fail(`only :nth-of-type(n) is supported among pseudo-classes`)
        c.nth = Number(m[1])
        this.i += m[0].length
      } else break
      any = true
    }
    if (!any) this.fail(this.peek() === "" ? "expected a selector" : `unexpected "${this.peek()}" (supported: tag, #id, .class, [attr], :nth-of-type(n), space and >)`)
    return c
  }
  complex(): Complex {
    const compounds: Compound[] = []
    const combinators: (" " | ">")[] = []
    this.skipSpace()
    compounds.push(this.compound())
    for (;;) {
      const spaced = this.skipSpace()
      const ch = this.peek()
      if (ch === "" || ch === ",") break
      if (ch === ">") {
        this.i++
        this.skipSpace()
        combinators.push(">")
      } else if (ch === "+" || ch === "~") {
        this.fail(`sibling combinators (+ and ~) are not supported`)
      } else if (spaced) combinators.push(" ")
      else this.fail(`unexpected "${ch}"`)
      compounds.push(this.compound())
    }
    return { compounds: compounds.reverse(), combinators: combinators.reverse() }
  }
}

/** Parses a selector list. Throws `InputError` for empty or unsupported syntax. */
export function parseSelector(source: string): SelectorList {
  if (typeof source !== "string" || source.trim() === "") throw new InputError("", "a selector must be a non-empty string")
  const p = new Parser(source)
  const complexes: Complex[] = []
  for (;;) {
    complexes.push(p.complex())
    p.skipSpace()
    if (p.peek() === ",") {
      p.i++
      continue
    }
    if (p.peek() !== "") p.fail(`unexpected "${p.peek()}"`)
    break
  }
  return { source, complexes }
}

function matchesCompound(c: Compound, e: SnapshotElement): boolean {
  if (c.tag !== undefined && c.tag !== e.tag) return false
  for (const id of c.ids) if (e.id !== id) return false
  for (const cls of c.classes) if (!(e.classes ?? []).includes(cls)) return false
  if (c.nth !== undefined && e.nth !== c.nth) return false
  for (const a of c.attrs) {
    const v = a.name === "id" ? e.id : a.name === "class" ? e.classes?.join(" ") : e.attrs?.[a.name]
    if (v === undefined) return false
    switch (a.op) {
      case "":
        break
      case "=":
        if (v !== a.value) return false
        break
      case "~=":
        if (!v.split(/\s+/).includes(a.value)) return false
        break
      case "^=":
        if (a.value === "" || !v.startsWith(a.value)) return false
        break
      case "$=":
        if (a.value === "" || !v.endsWith(a.value)) return false
        break
      case "*=":
        if (a.value === "" || !v.includes(a.value)) return false
        break
    }
  }
  return true
}

/** Does element `index` match the list? `elements` gives access to ancestors through `parent`. */
export function matches(list: SelectorList, elements: readonly SnapshotElement[], index: number): boolean {
  return list.complexes.some((cx) => matchFrom(cx, 0, elements, index))
}

function matchFrom(cx: Complex, k: number, els: readonly SnapshotElement[], index: number): boolean {
  const e = els[index]
  if (e === undefined || !matchesCompound(cx.compounds[k]!, e)) return false
  if (k === cx.compounds.length - 1) return true
  const comb = cx.combinators[k]
  let p = e.parent
  if (comb === ">") return p !== null && matchFrom(cx, k + 1, els, p)
  while (p !== null) {
    if (matchFrom(cx, k + 1, els, p)) return true
    p = els[p]?.parent ?? null
  }
  return false
}
