// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Overflow: audit a page's layout snapshot for inner scrollbars, sideways page scroll, misaligned list and table
// columns, titles that wrap, and clipped text. The rules are pure functions of the snapshot.
export { atLeast, check, fails } from "./check.ts"
export { bookmarklet, collectLayout, collectorExpression, COLLECTOR_SOURCE, type CollectOptions } from "./collector.ts"
export { DEFAULT_CONFIG, DEFAULT_RULES, parseConfig, resolveConfig, SEVERITIES } from "./config.ts"
export { formatMarkdown, formatText } from "./format.ts"
export { matches, parseSelector, type SelectorList } from "./selector.ts"
export { InputError, MAX_ELEMENTS, parseSnapshot, validateSnapshot } from "./snapshot.ts"
export {
  RULE_IDS,
  type Config,
  type Finding,
  type OverflowValue,
  type Rect,
  type Report,
  type ResolvedConfig,
  type RuleId,
  type Severity,
  type Snapshot,
  type SnapshotElement,
} from "./types.ts"
