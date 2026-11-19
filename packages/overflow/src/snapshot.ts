// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Reads and validates a layout snapshot. Snapshots come from files people pass around, so every field is checked and
// a bad one fails with its path (`elements[12].rect.width`), instead of a rule quietly reading `undefined`.
import type { Snapshot } from "./types.ts"

/** Thrown when a snapshot or config is malformed. `path` names the bad field. */
export class InputError extends Error {
  readonly path: string
  constructor(path: string, message: string) {
    super(path ? `${path}: ${message}` : message)
    this.name = "InputError"
    this.path = path
  }
}

/** The most elements a snapshot may hold (the collector's default limit is 20,000). */
export const MAX_ELEMENTS = 200_000

const OVERFLOW = new Set<string>(["visible", "hidden", "clip", "scroll", "auto"])
const ELEMENT_KEYS = new Set([
  "parent", "tag", "selector", "id", "classes", "attrs", "nth", "rect", "scrollWidth", "scrollHeight", "clientWidth",
  "clientHeight", "overflowX", "overflowY", "whiteSpace", "fontSize", "lineHeight", "display", "position", "direction",
  "visible", "textOverflow", "lineClamp", "textWrap", "colSpan", "text", "lines",
])

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

function num(v: unknown, path: string, opts: { min?: number; integer?: boolean } = {}): number {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new InputError(path, `must be a finite number, got ${describe(v)}`)
  if (opts.min !== undefined && v < opts.min) throw new InputError(path, `must be ${opts.min} or more, got ${v}`)
  if (opts.integer && !Number.isInteger(v)) throw new InputError(path, `must be a whole number, got ${v}`)
  return v
}

function str(v: unknown, path: string): string {
  if (typeof v !== "string") throw new InputError(path, `must be a string, got ${describe(v)}`)
  return v
}

function describe(v: unknown): string {
  if (v === null) return "null"
  if (Array.isArray(v)) return "an array"
  if (typeof v === "string") return JSON.stringify(v.length > 40 ? v.slice(0, 40) + "..." : v)
  if (typeof v === "number" || typeof v === "boolean") return String(v)
  return typeof v
}

function dir(v: unknown, path: string): "ltr" | "rtl" {
  if (v !== "ltr" && v !== "rtl") throw new InputError(path, `must be "ltr" or "rtl", got ${describe(v)}`)
  return v
}

/** Checks that `value` is a valid snapshot and returns it typed. Throws `InputError` naming the first bad field. */
export function validateSnapshot(value: unknown): Snapshot {
  if (!isObject(value)) throw new InputError("", `a snapshot must be a JSON object, got ${describe(value)}`)
  if (value.overflow !== 1) {
    throw new InputError("overflow", `must be 1 (the snapshot format version); is this a file from the overflow collector?`)
  }
  if (value.url !== undefined) str(value.url, "url")
  if (value.takenAt !== undefined) str(value.takenAt, "takenAt")
  if (value.truncated !== undefined && typeof value.truncated !== "boolean") throw new InputError("truncated", "must be true or false")
  if (value.direction !== undefined) dir(value.direction, "direction")

  const vp = value.viewport
  if (!isObject(vp)) throw new InputError("viewport", "must be an object with width and height")
  num(vp.width, "viewport.width", { min: 1 })
  num(vp.height, "viewport.height", { min: 1 })
  if (vp.label !== undefined) str(vp.label, "viewport.label")

  const doc = value.document
  if (!isObject(doc)) throw new InputError("document", "must be an object with scrollWidth, scrollHeight, clientWidth and clientHeight")
  for (const k of ["scrollWidth", "scrollHeight", "clientWidth", "clientHeight"]) num(doc[k], `document.${k}`, { min: 0 })

  const els = value.elements
  if (!Array.isArray(els)) throw new InputError("elements", `must be an array, got ${describe(els)}`)
  if (els.length > MAX_ELEMENTS) throw new InputError("elements", `has ${els.length} entries; the limit is ${MAX_ELEMENTS}`)
  els.forEach((e, i) => validateElement(e, i))
  return value as unknown as Snapshot
}

function validateElement(e: unknown, i: number): void {
  const p = `elements[${i}]`
  if (!isObject(e)) throw new InputError(p, `must be an object, got ${describe(e)}`)
  for (const k of Object.keys(e)) if (!ELEMENT_KEYS.has(k)) throw new InputError(`${p}.${k}`, "is not a snapshot field")
  if (e.parent !== null) {
    num(e.parent, `${p}.parent`, { min: 0, integer: true })
    if ((e.parent as number) >= i) throw new InputError(`${p}.parent`, `must point to an earlier element (got ${e.parent as number}); parents come before children`)
  }
  if (str(e.tag, `${p}.tag`) === "") throw new InputError(`${p}.tag`, "must not be empty")
  str(e.selector, `${p}.selector`)
  if (e.id !== undefined) str(e.id, `${p}.id`)
  if (e.classes !== undefined) {
    if (!Array.isArray(e.classes)) throw new InputError(`${p}.classes`, "must be an array of strings")
    e.classes.forEach((c, j) => str(c, `${p}.classes[${j}]`))
  }
  if (e.attrs !== undefined) {
    if (!isObject(e.attrs)) throw new InputError(`${p}.attrs`, "must be an object of strings")
    for (const [k, v] of Object.entries(e.attrs)) str(v, `${p}.attrs.${k}`)
  }
  if (e.nth !== undefined) num(e.nth, `${p}.nth`, { min: 1, integer: true })
  const r = e.rect
  if (!isObject(r)) throw new InputError(`${p}.rect`, "must be an object with x, y, width and height")
  num(r.x, `${p}.rect.x`)
  num(r.y, `${p}.rect.y`)
  num(r.width, `${p}.rect.width`, { min: 0 })
  num(r.height, `${p}.rect.height`, { min: 0 })
  for (const k of ["scrollWidth", "scrollHeight", "clientWidth", "clientHeight"]) num(e[k], `${p}.${k}`, { min: 0 })
  for (const k of ["overflowX", "overflowY"]) {
    if (typeof e[k] !== "string" || !OVERFLOW.has(e[k])) {
      throw new InputError(`${p}.${k}`, `must be one of visible, hidden, clip, scroll, auto; got ${describe(e[k])}`)
    }
  }
  str(e.whiteSpace, `${p}.whiteSpace`)
  num(e.fontSize, `${p}.fontSize`, { min: 0 })
  num(e.lineHeight, `${p}.lineHeight`, { min: 0 })
  for (const k of ["display", "position", "textOverflow", "textWrap", "text"]) if (e[k] !== undefined) str(e[k], `${p}.${k}`)
  if (e.direction !== undefined) dir(e.direction, `${p}.direction`)
  if (e.visible !== undefined && typeof e.visible !== "boolean") throw new InputError(`${p}.visible`, "must be true or false")
  if (e.lineClamp !== undefined) num(e.lineClamp, `${p}.lineClamp`, { min: 1, integer: true })
  if (e.colSpan !== undefined) num(e.colSpan, `${p}.colSpan`, { min: 1, integer: true })
  if (e.lines !== undefined) {
    if (!Array.isArray(e.lines)) throw new InputError(`${p}.lines`, "must be an array of strings")
    e.lines.forEach((l, j) => str(l, `${p}.lines[${j}]`))
  }
}

/** Parses snapshot JSON text and validates it. */
export function parseSnapshot(json: string): Snapshot {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch (err) {
    throw new InputError("", `not valid JSON (${(err as Error).message})`)
  }
  return validateSnapshot(value)
}

