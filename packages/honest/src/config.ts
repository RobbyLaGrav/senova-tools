// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Claim-checker configuration: which rules run, how severe they are, their options, custom pattern rules, and which
// files a directory scan includes. Config is validated up front so a typo fails the run instead of silently
// switching a rule off.
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { Document } from "./document.ts"
import { s, validateResults, type Infer } from "./results.ts"
import { BUILTIN_RULES, patternRule, type ClaimRule, type Severity } from "./rules.ts"

/** The name the CLI looks for in the working directory. */
export const CONFIG_FILE = "honest.config.json"

/** File extensions a directory scan reads when the config doesn't set `extensions`. */
export const DEFAULT_EXTENSIONS: readonly string[] = [
  ".md", ".mdx", ".markdown", ".txt", ".rst", ".tex", ".html", ".htm", ".astro", ".vue", ".svelte",
  ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json", ".yml", ".yaml",
]

/** Folders a directory scan skips, on top of the config's `ignore`. */
export const DEFAULT_IGNORE: readonly string[] = ["node_modules", ".git", "dist", "build", "coverage", ".next", ".turbo", ".cache"]

const severity = s.string({ oneOf: ["error", "warn", "off"] })
const ruleSetting = s.union(severity, s.tuple(severity, s.record(s.unknown())))

const configSchema = s.object(
  {
    $schema: s.optional(s.string()),
    rules: s.optional(s.record(ruleSetting)),
    custom: s.optional(
      s.array(
        s.object(
          {
            id: s.string({ pattern: /^[a-z][a-z0-9-]*[a-z0-9]$/ }),
            pattern: s.string({ minLength: 1 }),
            message: s.string({ minLength: 1 }),
            hint: s.optional(s.string()),
            severity: s.optional(s.string({ oneOf: ["error", "warn"] })),
          },
          { strict: true },
        ),
      ),
    ),
    extensions: s.optional(s.array(s.string({ pattern: /^\.[\w.-]+$/ }))),
    ignore: s.optional(s.array(s.string({ minLength: 1 }))),
  },
  { strict: true },
)

/** A rule's setting: a severity, or a severity with options, as in `["error", { "add": ["epic"] }]`. */
export type RuleSetting = Severity | "off" | readonly [Severity | "off", Record<string, unknown>]

export interface HonestConfig {
  rules?: Record<string, RuleSetting>
  custom?: Infer<typeof configSchema>["custom"]
  /** Extensions a directory scan reads, such as [".md", ".tsx"]. Files named on the command line are always read. */
  extensions?: readonly string[]
  /** Globs to skip, relative to the working directory: "drafts/**", "*.generated.ts". */
  ignore?: readonly string[]
}

/** Thrown for a config that can't be used. The message says what to fix. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ConfigError"
  }
}

/** A rule as it will run: severity and validated options settled. */
export interface ActiveRule {
  rule: ClaimRule
  severity: Severity
  options: unknown
}

/** Validates a config object. Throws `ConfigError` listing every problem. */
export function validateConfig(value: unknown): HonestConfig {
  const r = validateResults(value, configSchema)
  if (!r.ok) throw new ConfigError(`Invalid config:\n${r.issues.map((i) => `  ${i.path || "(root)"}: ${i.message}`).join("\n")}`)
  return value as HonestConfig
}

/** Reads and validates a JSON config file. */
export function loadConfig(file: string): HonestConfig {
  let text: string
  try {
    text = readFileSync(file, "utf8")
  } catch (err) {
    throw new ConfigError(`Could not read config ${file} (${(err as NodeJS.ErrnoException).code ?? (err as Error).message})`)
  }
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (err) {
    throw new ConfigError(`Config ${file} is not valid JSON (${(err as Error).message})`)
  }
  try {
    return validateConfig(data)
  } catch (err) {
    throw new ConfigError(`${file}: ${(err as Error).message}`)
  }
}

/** The config in `cwd/honest.config.json`, or an empty config when there is none. */
export function findConfig(cwd: string): { config: HonestConfig; file: string | null } {
  const file = join(cwd, CONFIG_FILE)
  return existsSync(file) ? { config: loadConfig(file), file } : { config: {}, file: null }
}

/**
 * Settles which rules run: built-ins plus `extraRules` plus the config's custom rules, each with its severity and
 * validated options. Unknown rule ids and bad options throw `ConfigError`, so a typo can't switch a check off.
 */
export function resolveRules(config: HonestConfig = {}, extraRules: readonly ClaimRule[] = []): ActiveRule[] {
  const all: ClaimRule[] = [...BUILTIN_RULES, ...extraRules]
  for (const c of config.custom ?? []) {
    const rule: Parameters<typeof patternRule>[0] = { id: c.id, pattern: c.pattern, message: c.message }
    if (c.hint !== undefined) rule.hint = c.hint
    if (c.severity !== undefined) rule.severity = c.severity as Severity
    try {
      all.push(patternRule(rule))
    } catch (err) {
      throw new ConfigError(`custom rule ${c.id}: ${(err as Error).message}`)
    }
  }
  const ids = new Set<string>()
  for (const r of all) {
    if (ids.has(r.id)) throw new ConfigError(`Two rules share the id "${r.id}"`)
    ids.add(r.id)
  }
  const settings = config.rules ?? {}
  for (const id of Object.keys(settings)) {
    if (!ids.has(id)) throw new ConfigError(`Unknown rule "${id}". Known rules: ${[...ids].join(", ")}`)
  }
  const active: ActiveRule[] = []
  for (const rule of all) {
    const setting = settings[rule.id]
    const [sev, options] = setting === undefined ? [rule.defaultSeverity, {}] : Array.isArray(setting) ? setting : [setting, {}]
    if (sev === "off") continue
    if (rule.options) {
      const r = validateResults(options, rule.options)
      if (!r.ok) throw new ConfigError(`rules.${rule.id} options: ${r.issues.map((i) => `${i.path || "(root)"} ${i.message}`).join("; ")}`)
      // Patterns in options are compiled now, so a bad regular expression fails here rather than mid-scan.
      try {
        rule.check(new Document(""), options)
      } catch (err) {
        throw new ConfigError(`rules.${rule.id} options: ${(err as Error).message}`)
      }
    }
    active.push({ rule, severity: sev as Severity, options })
  }
  return active
}
