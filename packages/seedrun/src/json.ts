// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
import { createHash } from "node:crypto"

/**
 * Serialises a value to canonical JSON: object keys sorted, two-space indent, a trailing newline, typed arrays as
 * plain arrays, -0 written as 0. The same value always gives the same bytes, whatever order its keys were added in.
 *
 * Throws (naming the path) instead of silently changing data the way `JSON.stringify` does: NaN and Infinity, bigint,
 * functions, symbols, `undefined` inside arrays, and objects that are not plain (Map, Set, Date, class instances).
 * `undefined` object properties are left out, as in `JSON.stringify`.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(normalise(value, "$"), null, 2) + "\n"
}

/** SHA-256 of a string, as lower-case hex. */
export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}

function normalise(value: unknown, path: string): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${path} is ${value}; JSON has no non-finite numbers`)
    return Object.is(value, -0) ? 0 : value
  }
  if (Array.isArray(value)) {
    return value.map((v, i) => {
      if (v === undefined) throw new TypeError(`${path}[${i}] is undefined`)
      return normalise(v, `${path}[${i}]`)
    })
  }
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    const items = Array.from(value as unknown as ArrayLike<number | bigint>)
    return items.map((v, i) => normalise(v, `${path}[${i}]`))
  }
  if (typeof value === "object") {
    const proto: unknown = Object.getPrototypeOf(value)
    if (proto !== Object.prototype && proto !== null) {
      const kind = (value as object).constructor?.name ?? "object"
      throw new TypeError(`${path} is a ${kind}; use plain objects and arrays`)
    }
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key]
      if (v !== undefined) out[key] = normalise(v, `${path}.${key}`)
    }
    return out
  }
  throw new TypeError(`${path} is a ${typeof value}, which JSON can't hold`)
}
