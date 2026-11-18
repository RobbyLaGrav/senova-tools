// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// The README's two-minute example: load a results file, pick the headline setting by rule, and write sentences
// whose numbers and comparative words come from the data. Run: node examples/article.ts
// (In your own project, import from "@senova/honest" instead of "../src/index.ts".)
import { compare, loadResults, pickHeadline, s, times, within } from "../src/index.ts"

const schema = s.object({
  note: s.string({ pattern: /simulat/i }),
  baseline: s.object({ name: s.string(), rms_mm: s.number({ min: 0 }), ops: s.number({ min: 1 }) }),
  settings: s.array(s.object({ name: s.string(), rms_mm: s.number({ min: 0 }), ops: s.number({ min: 1 }) }), { minLength: 1 }),
})

/** Builds the article text from a results file. Exported so the test can check it against the data. */
export function article(file: string | URL): string[] {
  const r = loadResults(file, schema)
  const base = r.baseline

  const pick = pickHeadline(r.settings, {
    label: "largest saving within 10 % extra error",
    score: (x) => base.ops / x.ops,
    where: (x) => within(x.rms_mm, base.rms_mm, { pct: 10, better: "lower" }),
  })
  const headline = pick
    ? `The ${pick.item.name} setting did ${times(pick.item.ops, base.ops)} arithmetic than ${base.name} (${pick.rule}).`
    : `No setting saved arithmetic within 10 % extra error of ${base.name}.`

  const best = [...r.settings].sort((a, b) => a.rms_mm - b.rms_mm)[0]!
  const accuracy = `Its most accurate setting ${compare(best.rms_mm, base.rms_mm, { better: "lower", unit: "mm", against: base.name }).text}.`

  return [headline, accuracy, r.note]
}

if (import.meta.main) console.log(article(new URL("./results.json", import.meta.url)).join("\n"))
