// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Honest: publish research results that can't drift from the data.
//   1. Typed results     load and validate a results file           (results.ts)
//   2. Computed wording  sentences whose comparatives come from data (wording.ts)
//   3. Headlines         the setting a headline reports, by rule     (headline.ts)
//   4. Claim checker     hype, hardware, price, vendor, http checks  (rules.ts, check.ts, config.ts, cli.ts)

export { loadResults, parseResults, ResultsError, s, validateResults } from "./results.ts"
export type { ArrayOptions, Infer, Issue, NumberOptions, ObjectOptions, OptionalSchema, Schema, StringOptions, ValidationResult } from "./results.ts"

export { compare, describeChange, formatNumber, percentChange, times } from "./wording.ts"
export type { Better, ChangeOptions, CompareOptions, Comparison, FormatOptions, Outcome, TimesOptions } from "./wording.ts"

export { pickHeadline, within } from "./headline.ts"
export type { Headline, HeadlineRule, WithinOptions } from "./headline.ts"

export { checkPaths, checkText, globToRegExp } from "./check.ts"
export type { CheckOptions, Finding, PathsResult } from "./check.ts"

export { CONFIG_FILE, ConfigError, DEFAULT_EXTENSIONS, DEFAULT_IGNORE, findConfig, loadConfig, resolveRules, validateConfig } from "./config.ts"
export type { ActiveRule, HonestConfig, RuleSetting } from "./config.ts"

export { BUILTIN_RULES, DEFAULT_HTTP_ALLOW, hardwareClaim, hype, insecureSource, patternRule, price, simulationNote, vendorFigure } from "./rules.ts"
export type { ClaimRule, CustomRuleConfig, RuleHit, Severity } from "./rules.ts"

export { Document } from "./document.ts"
export type { Position, Span } from "./document.ts"

export { formatFindings, summarize } from "./report.ts"
export type { ReportFormat } from "./report.ts"

export { EXIT, run } from "./cli.ts"
export type { CliIO } from "./cli.ts"
