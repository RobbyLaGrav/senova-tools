// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Typed results: describe the shape of a results file once, then load it with every problem listed by path.
// A page that reads a results file through a schema fails loudly when a re-run renames or drops a field, instead
// of printing "undefined" or a stale number.
import { readFileSync } from "node:fs"

/** One problem found while validating, with a JSON-style path such as `methods[2].rms`. */
export interface Issue {
  path: string
  message: string
}

/** A validator for values of type `T`. Build one with the `s` helpers. */
export interface Schema<T> {
  readonly kind: string
  /** Pushes an issue for every problem found under `path`. */
  check(value: unknown, path: string, issues: Issue[]): void
  /** Type-only marker; never set at run time. */
  readonly _type?: T
}

/** A schema whose key may be missing from an object. */
export interface OptionalSchema<T> extends Schema<T | undefined> {
  readonly optional: true
}

/** The TypeScript type a schema validates. */
export type Infer<S> = S extends Schema<infer T> ? T : never

type Shape = Record<string, Schema<unknown>>
type OptionalKeys<S extends Shape> = { [K in keyof S]: S[K] extends OptionalSchema<unknown> ? K : never }[keyof S]
type Simplify<T> = { [K in keyof T]: T[K] } & {}
type ObjectOf<S extends Shape> = Simplify<
  { [K in Exclude<keyof S, OptionalKeys<S>>]: Infer<S[K]> } & { [K in OptionalKeys<S>]?: Exclude<Infer<S[K]>, undefined> }
>

const describe = (v: unknown): string => (v === null ? "null" : Array.isArray(v) ? "an array" : typeof v)
const join = (path: string, key: string): string => (/^[A-Za-z_$][\w$]*$/.test(key) ? (path ? `${path}.${key}` : key) : `${path}[${JSON.stringify(key)}]`)

export interface NumberOptions {
  min?: number
  max?: number
  integer?: boolean
}

export interface StringOptions {
  /** The string must match this pattern, for example `/simulat/i` on a note field. */
  pattern?: RegExp
  /** The string must be one of these values. */
  oneOf?: readonly string[]
  minLength?: number
}

export interface ArrayOptions {
  minLength?: number
  maxLength?: number
}

export interface ObjectOptions {
  /** Reject keys the schema doesn't name. Default false: results files often carry extra fields. */
  strict?: boolean
}

/** Schema builders. `s.object({ rms: s.number({ min: 0 }) })` and so on. */
export const s = {
  /** A finite number: NaN and Infinity are rejected, because they print as nonsense in a sentence. */
  number(opts: NumberOptions = {}): Schema<number> {
    return {
      kind: "number",
      check(v, path, issues) {
        if (typeof v !== "number") return void issues.push({ path, message: `expected a number, got ${describe(v)}` })
        if (!Number.isFinite(v)) return void issues.push({ path, message: `expected a finite number, got ${v}` })
        if (opts.integer && !Number.isInteger(v)) issues.push({ path, message: `expected an integer, got ${v}` })
        if (opts.min !== undefined && v < opts.min) issues.push({ path, message: `must be at least ${opts.min}, got ${v}` })
        if (opts.max !== undefined && v > opts.max) issues.push({ path, message: `must be at most ${opts.max}, got ${v}` })
      },
    }
  },

  string(opts: StringOptions = {}): Schema<string> {
    return {
      kind: "string",
      check(v, path, issues) {
        if (typeof v !== "string") return void issues.push({ path, message: `expected a string, got ${describe(v)}` })
        if (opts.minLength !== undefined && v.length < opts.minLength) issues.push({ path, message: `must be at least ${opts.minLength} characters` })
        if (opts.pattern && !opts.pattern.test(v)) issues.push({ path, message: `must match ${opts.pattern}` })
        if (opts.oneOf && !opts.oneOf.includes(v)) issues.push({ path, message: `must be one of ${opts.oneOf.map((x) => JSON.stringify(x)).join(", ")}, got ${JSON.stringify(v)}` })
      },
    }
  },

  boolean(): Schema<boolean> {
    return {
      kind: "boolean",
      check(v, path, issues) {
        if (typeof v !== "boolean") issues.push({ path, message: `expected a boolean, got ${describe(v)}` })
      },
    }
  },

  /** Exactly this value, for example a format version: `s.literal(2)`. */
  literal<const T extends string | number | boolean | null>(value: T): Schema<T> {
    return {
      kind: "literal",
      check(v, path, issues) {
        if (v !== value) issues.push({ path, message: `expected ${JSON.stringify(value)}, got ${JSON.stringify(v) ?? describe(v)}` })
      },
    }
  },

  array<T>(item: Schema<T>, opts: ArrayOptions = {}): Schema<T[]> {
    return {
      kind: "array",
      check(v, path, issues) {
        if (!Array.isArray(v)) return void issues.push({ path, message: `expected an array, got ${describe(v)}` })
        if (opts.minLength !== undefined && v.length < opts.minLength) issues.push({ path, message: `needs at least ${opts.minLength} items, has ${v.length}` })
        if (opts.maxLength !== undefined && v.length > opts.maxLength) issues.push({ path, message: `allows at most ${opts.maxLength} items, has ${v.length}` })
        v.forEach((x, i) => item.check(x, `${path}[${i}]`, issues))
      },
    }
  },

  object<S extends Shape>(shape: S, opts: ObjectOptions = {}): Schema<ObjectOf<S>> {
    return {
      kind: "object",
      check(v, path, issues) {
        if (typeof v !== "object" || v === null || Array.isArray(v)) return void issues.push({ path, message: `expected an object, got ${describe(v)}` })
        const obj = v as Record<string, unknown>
        for (const [key, schema] of Object.entries(shape)) {
          const p = join(path, key)
          if (obj[key] === undefined) {
            if (!("optional" in schema)) issues.push({ path: p, message: "is missing" })
            continue
          }
          schema.check(obj[key], p, issues)
        }
        if (opts.strict) for (const key of Object.keys(obj)) if (!(key in shape)) issues.push({ path: join(path, key), message: "is not expected here" })
      },
    }
  },

  /** An object used as a map: any keys, every value matching `value`. */
  record<T>(value: Schema<T>): Schema<Record<string, T>> {
    return {
      kind: "record",
      check(v, path, issues) {
        if (typeof v !== "object" || v === null || Array.isArray(v)) return void issues.push({ path, message: `expected an object, got ${describe(v)}` })
        for (const [key, x] of Object.entries(v)) value.check(x, join(path, key), issues)
      },
    }
  },

  /** Any value. Useful for a field you pass through without reading. */
  unknown(): Schema<unknown> {
    return { kind: "unknown", check() {} }
  },

  /** A value matching at least one of the schemas: `s.union(s.string(), s.number())`. */
  union<const T extends readonly Schema<unknown>[]>(...options: T): Schema<Infer<T[number]>> {
    const kind = options.map((o) => o.kind).join(" | ")
    return {
      kind,
      check(v, path, issues) {
        const attempts = options.map((o) => {
          const found: Issue[] = []
          o.check(v, path, found)
          return found
        })
        if (attempts.some((a) => a.length === 0)) return
        issues.push({ path, message: `expected ${kind}; ${attempts.map((a) => a.map((i) => i.message).join(", ")).join(" / ")}` })
      },
    }
  },

  /** A fixed-length array with one schema per position: `s.tuple(s.string(), s.number())`. */
  tuple<const T extends readonly Schema<unknown>[]>(...items: T): Schema<{ -readonly [K in keyof T]: Infer<T[K]> }> {
    return {
      kind: `[${items.map((i) => i.kind).join(", ")}]`,
      check(v, path, issues) {
        if (!Array.isArray(v)) return void issues.push({ path, message: `expected an array, got ${describe(v)}` })
        if (v.length !== items.length) return void issues.push({ path, message: `expected ${items.length} items, has ${v.length}` })
        items.forEach((item, i) => item.check(v[i], `${path}[${i}]`, issues))
      },
    }
  },

  /** The key may be missing. A present key must still match. */
  optional<T>(inner: Schema<T>): OptionalSchema<T> {
    return {
      kind: `optional ${inner.kind}`,
      optional: true,
      check(v, path, issues) {
        if (v !== undefined) inner.check(v, path, issues)
      },
    }
  },
} as const

/** Thrown when a results file can't be read, parsed or validated. `issues` lists every problem. */
export class ResultsError extends Error {
  readonly issues: readonly Issue[]
  constructor(source: string, issues: readonly Issue[]) {
    const list = issues.map((i) => `  ${i.path || "(root)"}: ${i.message}`).join("\n")
    super(`${source} does not match the results schema:\n${list}`)
    this.name = "ResultsError"
    this.issues = issues
  }
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; issues: Issue[] }

/** Checks a value against a schema without throwing. */
export function validateResults<T>(value: unknown, schema: Schema<T>): ValidationResult<T> {
  const issues: Issue[] = []
  schema.check(value, "", issues)
  return issues.length ? { ok: false, issues } : { ok: true, value: value as T }
}

/** Parses JSON text and validates it. Throws `ResultsError` listing every problem. */
export function parseResults<T>(json: string, schema: Schema<T>, source = "results"): T {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch (err) {
    throw new ResultsError(source, [{ path: "", message: `is not valid JSON (${(err as Error).message})` }])
  }
  const r = validateResults(data, schema)
  if (!r.ok) throw new ResultsError(source, r.issues)
  return r.value
}

/** Reads a results file from disk, parses and validates it. Throws `ResultsError` listing every problem. */
export function loadResults<T>(file: string | URL, schema: Schema<T>): T {
  const source = String(file)
  let text: string
  try {
    text = readFileSync(file, "utf8")
  } catch (err) {
    throw new ResultsError(source, [{ path: "", message: `could not be read (${(err as NodeJS.ErrnoException).code ?? (err as Error).message})` }])
  }
  return parseResults(text, schema, source)
}
