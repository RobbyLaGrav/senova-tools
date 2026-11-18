// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
// honest-ignore-file -- this file defines the words and phrases the rules look for
//
// The built-in claim rules. Each one says what it looks for, why, and what to write instead. They are deliberately
// plain regular expressions over sentences: predictable, fast, and easy to read when one fires.
import type { Document } from "./document.ts"
import { s, validateResults, type Schema } from "./results.ts"

export type Severity = "error" | "warn"

/** One match a rule reports, as character offsets into the document. */
export interface RuleHit {
  index: number
  length: number
  message: string
  /** What to write instead. */
  hint?: string
}

export interface ClaimRule {
  /** Short kebab-case id, used in config and ignore directives. */
  id: string
  /** One line for `honest rules`. */
  summary: string
  /** Severity when the config doesn't set one. "off" rules run only when switched on. */
  defaultSeverity: Severity | "off"
  /** Validates the rule's options from the config. Omit for a rule that takes none. */
  options?: Schema<unknown>
  check(doc: Document, options: unknown): RuleHit[]
}

/** Reads a rule's options with its schema; config validation has already rejected bad ones. */
function opts<T>(schema: Schema<T>, value: unknown): T {
  const r = validateResults(value ?? {}, schema)
  if (!r.ok) throw new TypeError(r.issues.map((i) => `${i.path}: ${i.message}`).join("; "))
  return r.value
}

const NEGATION = /\b(not|never|no|nothing|none|neither|nor|without|cannot|yet to be|has yet|have yet)\b|n['’]t\b/i

/** True when one of the `words` words before `index` (in the same sentence) negates it: "not proven". */
function negated(doc: Document, index: number, words: number): boolean {
  const sentence = doc.sentenceAt(index)
  const before = doc.text.slice(sentence.start, index).split(/\s+/).filter(Boolean).slice(-words).join(" ")
  return NEGATION.test(before)
}

function* matches(text: string, re: RegExp): Generator<RegExpExecArray> {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`)
  for (let m = g.exec(text); m; m = g.exec(text)) {
    if (m[0] === "") {
      g.lastIndex++
      continue
    }
    yield m
  }
}

const regex = (source: string, id: string): RegExp => {
  try {
    return new RegExp(source, "i")
  } catch (err) {
    throw new TypeError(`${id}: invalid pattern ${JSON.stringify(source)} (${(err as Error).message})`)
  }
}

const listOptions = { add: s.optional(s.array(s.string({ minLength: 1 }))), allow: s.optional(s.array(s.string({ minLength: 1 }))) }

// ---------------------------------------------------------------------------------------------------------------
// hype

const HYPE: readonly (readonly [string, string])[] = [
  ["breakthrough", String.raw`break-?throughs?`],
  ["first-ever", String.raw`first[- ]ever`],
  ["world's first", String.raw`world['’]?s?[- ]first`],
  ["first of its kind", String.raw`first[- ]of[- ]its[- ]kind`],
  ["revolutionary", String.raw`revolutioni[sz](e|es|ed|ing)|revolutionary`],
  ["game-changing", String.raw`game[- ]chang(ing|ers?)`],
  ["proven", String.raw`proven`],
  ["state of the art", String.raw`state[- ]of[- ]the[- ]art|SOTA`],
  ["unprecedented", String.raw`unprecedented`],
  ["best-in-class", String.raw`best[- ]in[- ]class`],
  ["groundbreaking", String.raw`ground-?breaking`],
  ["industry-leading", String.raw`(industry|market|world)[- ]leading`],
]

const hypeSchema = s.object(listOptions, { strict: true })

export const hype: ClaimRule = {
  id: "hype",
  summary: 'Hype words such as "breakthrough", "first-ever", "proven" and "state of the art".',
  defaultSeverity: "error",
  options: hypeSchema,
  check(doc, options) {
    const o = opts(hypeSchema, options)
    const allow = new Set((o.allow ?? []).map((w) => w.toLowerCase()))
    const words = [...HYPE.filter(([label]) => !allow.has(label)), ...(o.add ?? []).map((w) => [w, w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")] as const)]
    const hits: RuleHit[] = []
    for (const [label, source] of words) {
      for (const m of matches(doc.text, new RegExp(String.raw`(?<![\w-])(?:${source})(?![\w-])`, "i"))) {
        if (negated(doc, m.index, 3)) continue
        hits.push({
          index: m.index,
          length: m[0].length,
          message: `"${m[0]}" is a hype word (${label}).`,
          hint: "Say what was measured or simulated and by how much; let the number carry the claim.",
        })
      }
    }
    return hits
  },
}

// ---------------------------------------------------------------------------------------------------------------
// hardware-claim

const HARDWARE: readonly RegExp[] = [
  /\b(measured|tested|verified|validated|demonstrated|benchmarked|confirmed)(?:\s+[\w-]+){0,2}?\s+(on|in|with|using)\s+(real\s+|physical\s+)?(hardware|silicon|(a|the|our|this|actual)\s+(real\s+|physical\s+)?(chip|device|prototype|board|hardware|silicon|part))\b/i,
  /\b(hardware|bench|lab|on-?chip|silicon)\s+(measurements?|results|tests?|data)\s+(show|showed|shows|confirm|confirmed|confirms|prove|proved|proves|demonstrate|demonstrated|demonstrates)\b/i,
  /\bmeasured\s+(power|energy|latency|current|consumption|throughput|efficiency)\b/i,
]

const hardwareSchema = s.object({ add: s.optional(s.array(s.string({ minLength: 1 }))) }, { strict: true })

export const hardwareClaim: ClaimRule = {
  id: "hardware-claim",
  summary: "Claims of a hardware measurement, for results that come from simulation.",
  defaultSeverity: "error",
  options: hardwareSchema,
  check(doc, options) {
    const o = opts(hardwareSchema, options)
    const patterns = [...HARDWARE, ...(o.add ?? []).map((p) => regex(p, "hardware-claim"))]
    const hits: RuleHit[] = []
    for (const re of patterns) {
      for (const m of matches(doc.text, re)) {
        const after = doc.text.slice(m.index + m[0].length, m.index + m[0].length + 12)
        if (negated(doc, m.index, 6) || /^\s+yet\b/i.test(after)) continue
        hits.push({
          index: m.index,
          length: m[0].length,
          message: `"${m[0]}" claims a hardware measurement.`,
          hint: "If the result is simulated, say so. If it really was measured, describe the setup and switch this rule off for that file.",
        })
      }
    }
    return hits
  },
}

// ---------------------------------------------------------------------------------------------------------------
// simulation-note (off unless configured)

const noteSchema = s.object({ pattern: s.optional(s.string({ minLength: 1 })) }, { strict: true })
const DEFAULT_NOTE = String.raw`\bsimulat(ed|ion|ions)\b|\bnot (been |yet )?measured on hardware\b`

export const simulationNote: ClaimRule = {
  id: "simulation-note",
  summary: "Each file must carry a note saying its results are simulated (off unless switched on).",
  defaultSeverity: "off",
  options: noteSchema,
  check(doc, options) {
    const o = opts(noteSchema, options)
    if (regex(o.pattern ?? DEFAULT_NOTE, "simulation-note").test(doc.text)) return []
    return [
      {
        index: 0,
        length: 0,
        message: "No simulation note found in this file.",
        hint: 'Add a sentence such as "These results come from simulation; nothing was measured on hardware."',
      },
    ]
  },
}

// ---------------------------------------------------------------------------------------------------------------
// price

const PRICE: readonly RegExp[] = [
  /(?<![\w\\$])(US|CA|AU|NZ|HK|S)?[$€£¥]\s?\d[\d,]*(\.\d+)?(\s?(k|m|bn|million|billion|thousand)\b)?/i,
  /\b\d[\d,]*(\.\d+)?\s?(USD|EUR|GBP|JPY|CHF|CAD|AUD|dollars?|euros?|cents?|pounds sterling)\b/i,
  /\b(USD|EUR|GBP|JPY|CHF|CAD|AUD)\s?\d/i,
]
const PRICE_WORD = /\b(pric(e|es|ed|ing)|retails? (at|for)|costs? (just|only) )\b/i

const priceSchema = s.object({ allow: s.optional(s.array(s.string({ minLength: 1 }))) }, { strict: true })

export const price: ClaimRule = {
  id: "price",
  summary: "Prices and money amounts, which go stale and can read as an offer.",
  defaultSeverity: "error",
  options: priceSchema,
  check(doc, options) {
    const o = opts(priceSchema, options)
    const allow = (o.allow ?? []).map((p) => regex(p, "price"))
    const hits: RuleHit[] = []
    const add = (index: number, text: string): void => {
      if (allow.some((a) => a.test(text))) return
      if (hits.some((h) => index >= h.index && index < h.index + h.length)) return
      hits.push({ index, length: text.length, message: `"${text}" looks like a price.`, hint: "Leave prices out of research text, or link to a dated price page." })
    }
    for (const re of PRICE) for (const m of matches(doc.text, re)) add(m.index, m[0])
    for (const m of matches(doc.text, PRICE_WORD)) {
      const sentence = doc.sentenceAt(m.index)
      if (/\d/.test(doc.text.slice(sentence.start, sentence.end))) add(m.index, m[0])
    }
    return hits.sort((a, b) => a.index - b.index)
  },
}

// ---------------------------------------------------------------------------------------------------------------
// vendor-figure

const VENDOR_TRIGGER = /\b(vendors?|manufacturers?|suppliers?|advertised|advertises|claims|claimed|marketing|press release|data ?sheets?|spec(ification)? sheets?)\b/i
const VENDOR_LABEL = [
  /\bvendor[- ](figures?|claims?|numbers?|data|reported|stated|supplied)\b/i,
  /\b(vendor|manufacturer)['’]s (own )?(figures?|claims?|numbers?|data)\b/i,
  /\b(according to|per|from) the (vendor|manufacturer|data ?sheet)\b/i,
  /\b(not|un)(independently )?verified\b/i,
]

const vendorSchema = s.object({ vendors: s.optional(s.array(s.string({ minLength: 1 }))), labels: s.optional(s.array(s.string({ minLength: 1 }))) }, { strict: true })

/** A figure: a digit outside URLs and four-digit years. */
const hasFigure = (text: string): boolean => /\d/.test(text.replace(/\bhttps?:\/\/\S+/g, "").replace(/\b(19|20)\d{2}\b/g, ""))

export const vendorFigure: ClaimRule = {
  id: "vendor-figure",
  summary: 'Figures from vendors, datasheets or press releases that are not labelled "vendor figure".',
  defaultSeverity: "error",
  options: vendorSchema,
  check(doc, options) {
    const o = opts(vendorSchema, options)
    const names = (o.vendors ?? []).map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    const trigger = names.length ? new RegExp(`${VENDOR_TRIGGER.source}|\\b(${names.join("|")})\\b`, "i") : VENDOR_TRIGGER
    const labels = [...VENDOR_LABEL, ...(o.labels ?? []).map((p) => regex(p, "vendor-figure"))]
    const hits: RuleHit[] = []
    for (const span of doc.sentences()) {
      const sentence = doc.text.slice(span.start, span.end)
      const m = trigger.exec(sentence)
      if (!m || !hasFigure(sentence) || labels.some((l) => l.test(sentence))) continue
      hits.push({
        index: span.start + m.index,
        length: m[0].length,
        message: `A figure attributed to "${m[0]}" is not marked as a vendor figure.`,
        hint: 'Say "vendor figure" (or "from the datasheet") so readers know you did not measure it.',
      })
    }
    return hits
  },
}

// ---------------------------------------------------------------------------------------------------------------
// insecure-source

/** Plain-http prefixes that are not sources: local addresses, examples and XML namespaces. */
export const DEFAULT_HTTP_ALLOW: readonly string[] = [
  "http://localhost",
  "http://127.0.0.1",
  "http://0.0.0.0",
  "http://[::1]",
  "http://example.com",
  "http://example.org",
  "http://www.w3.org/",
  "http://json-schema.org/",
  "http://schemas.xmlsoap.org/",
  "http://schemas.openxmlformats.org/",
  "http://purl.org/",
]

const httpSchema = s.object({ allow: s.optional(s.array(s.string({ minLength: 1 }))) }, { strict: true })

export const insecureSource: ClaimRule = {
  id: "insecure-source",
  summary: "Links to sources over plain http instead of https.",
  defaultSeverity: "error",
  options: httpSchema,
  check(doc, options) {
    const o = opts(httpSchema, options)
    const allow = [...DEFAULT_HTTP_ALLOW, ...(o.allow ?? [])].map((a) => a.toLowerCase())
    const hits: RuleHit[] = []
    for (const m of matches(doc.text, /\bhttp:\/\/[^\s"'`<>)\]}]+/i)) {
      const url = m[0].replace(/[.,;:!?]+$/, "")
      const lower = url.toLowerCase()
      if (allow.some((a) => lower.startsWith(a))) continue
      if (/^http:\/\/[^/]*\.(localhost|test|local)(?=[:/]|$)/i.test(url)) continue
      hits.push({ index: m.index, length: url.length, message: `${url} is not https.`, hint: "Link the https version, or archive the page and link the archive." })
    }
    return hits
  },
}

/** Every built-in rule, in the order `honest rules` lists them. */
export const BUILTIN_RULES: readonly ClaimRule[] = [hype, hardwareClaim, simulationNote, price, vendorFigure, insecureSource]

/** A pattern rule written in the config file. */
export interface CustomRuleConfig {
  id: string
  /** A regular expression source, matched case-insensitively. */
  pattern: string
  message: string
  hint?: string
  severity?: Severity
}

/** Builds a rule from a config entry: every match of `pattern` is a finding. */
export function patternRule(c: CustomRuleConfig): ClaimRule {
  const re = regex(c.pattern, c.id)
  return {
    id: c.id,
    summary: c.message,
    defaultSeverity: c.severity ?? "error",
    check(doc) {
      return [...matches(doc.text, re)].map((m) => {
        const hit: RuleHit = { index: m.index, length: m[0].length, message: `"${m[0]}": ${c.message}` }
        if (c.hint !== undefined) hit.hint = c.hint
        return hit
      })
    },
  }
}
