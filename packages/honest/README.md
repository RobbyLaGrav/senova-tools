# Honest

Publish research results that can't drift from the data: typed results files, sentences whose numbers and comparative words are computed, headlines picked by a written rule, and a claim checker for CI.

**For:** labs, companies and writers who publish results on a website, in docs or in a report. **Status:** in progress.

Honest has four parts. Use any of them on its own.

| Part | What it stops |
| --- | --- |
| **Typed results** (`s`, `loadResults`) | A re-run renames a field and the page prints `undefined`, `NaN` or a stale number. |
| **Computed wording** (`compare`, `describeChange`, `times`) | A re-run flips a result but the text still says "cut the error". |
| **Rule-based headlines** (`pickHeadline`, `within`) | Someone picks the best-looking row by hand after seeing the data. |
| **Claim checker** (`honest check`, `checkText`) | Hype words, hardware claims for simulated work, prices, unlabelled vendor figures and plain-http sources. |

## Install

```sh
npm install @senova/honest
```

Node.js 24 or newer. No runtime dependencies.

## Two-minute example

A results file, as your study wrote it ([examples/results.json](examples/results.json)):

```json
{
  "note": "Simulated results. Nothing here was measured on hardware.",
  "baseline": { "name": "the dense network", "rms_mm": 0.30, "ops": 4608 },
  "settings": [
    { "name": "exact", "rms_mm": 0.30, "ops": 4100 },
    { "name": "low threshold", "rms_mm": 0.32, "ops": 1500 },
    { "name": "mid threshold", "rms_mm": 0.33, "ops": 900 },
    { "name": "high threshold", "rms_mm": 0.45, "ops": 400 }
  ]
}
```

The page reads it through a schema, picks its headline by rule and computes every number and comparative word ([examples/article.ts](examples/article.ts)):

```ts
import { compare, loadResults, pickHeadline, s, times, within } from "@senova/honest"

const schema = s.object({
  note: s.string({ pattern: /simulat/i }), // the file must say it is simulated
  baseline: s.object({ name: s.string(), rms_mm: s.number({ min: 0 }), ops: s.number({ min: 1 }) }),
  settings: s.array(s.object({ name: s.string(), rms_mm: s.number({ min: 0 }), ops: s.number({ min: 1 }) }), { minLength: 1 }),
})
const r = loadResults("results.json", schema) // typed; throws listing every problem by path
const base = r.baseline

const pick = pickHeadline(r.settings, {
  label: "largest saving within 10 % extra error",
  score: (x) => base.ops / x.ops,
  where: (x) => within(x.rms_mm, base.rms_mm, { pct: 10, better: "lower" }),
})
console.log(pick
  ? `The ${pick.item.name} setting did ${times(pick.item.ops, base.ops)} arithmetic than ${base.name} (${pick.rule}).`
  : `No setting saved arithmetic within 10 % extra error of ${base.name}.`)

const best = [...r.settings].sort((a, b) => a.rms_mm - b.rms_mm)[0]!
console.log(`Its most accurate setting ${compare(best.rms_mm, base.rms_mm, { better: "lower", unit: "mm", against: base.name }).text}.`)
console.log(r.note)
```

Output (`node examples/article.ts`):

```text
The mid threshold setting did 5.1× less arithmetic than the dense network (largest saving within 10 % extra error).
Its most accurate setting matched the dense network (both 0.30 mm).
Simulated results. Nothing here was measured on hardware.
```

If a re-run makes the best setting 0.40 mm, the second sentence becomes "did not beat the dense network (0.40 mm against 0.30 mm)" with no edit to the text. If nothing stays within the error budget, the headline says so.

Then check the published text in CI:

```sh
npx honest check docs/ content/
```

<!-- honest-ignore-start -->
```text
docs/draft.md:3:6  error  hype  "breakthrough" is a hype word (breakthrough).
    Say what was measured or simulated and by how much; let the number carry the claim.
docs/draft.md:3:23  error  hardware-claim  "measured on our chip" claims a hardware measurement.
    If the result is simulated, say so. If it really was measured, describe the setup and switch this rule off for that file.
docs/draft.md:4:24  error  insecure-source  http://example.net/paper.pdf is not https.
    Link the https version, or archive the page and link the archive.
3 errors and 0 warnings in 12 files.
```
<!-- honest-ignore-end -->

## Claim checker

### Rules

<!-- honest-ignore-start -->
| Rule | Default | Fires on | Stays quiet on |
| --- | --- | --- | --- |
| `hype` | error | breakthrough, first-ever, world's first, first of its kind, revolutionary, game-changing, proven, state of the art / SOTA, unprecedented, best-in-class, groundbreaking, industry-leading | a negation in the three words before ("not proven"); "unproven" |
| `hardware-claim` | error | "measured on our chip", "verified on real hardware", "bench measurements show", "measured power" | a negation in the six words before, or "yet" after ("not measured on hardware yet") |
| `simulation-note` | off | a file with no simulation note (default pattern: "simulated", "simulation", "not measured on hardware") | files that have one |
| `price` | error | "$499", "€1,200", "30 USD", "EUR 40", "price" in a sentence with a number | `${template}` strings, "costs 40 operations", amounts matching `allow` |
| `vendor-figure` | error | a sentence with a figure that names a vendor, manufacturer, supplier, datasheet, press release, advertising, a claim, or a vendor from your `vendors` list | the same sentence labelled "vendor figure", "the manufacturer's own figure", "from the datasheet" or "unverified"; four-digit years and digits inside URLs |
| `insecure-source` | error | `http://` links | https; localhost, 127.0.0.1, `.test` and `.localhost` hosts; example.com; XML namespaces such as www.w3.org |
<!-- honest-ignore-end -->

### Config

`honest.config.json` in the working directory, or `--config <file>`. Every key is optional and checked: an unknown rule id or option fails the run with exit code 2, so a typo can't silently switch a check off.

<!-- honest-ignore-start -->
```json
{
  "rules": {
    "simulation-note": "error",
    "price": "warn",
    "hype": ["error", { "add": ["epic"], "allow": ["proven"] }],
    "vendor-figure": ["error", { "vendors": ["Acme"], "labels": ["per Acme's sheet"] }],
    "hardware-claim": ["error", { "add": ["ran on the dev kit"] }],
    "insecure-source": ["error", { "allow": ["http://intranet.example/"] }]
  },
  "custom": [{ "id": "no-guarantee", "pattern": "guarantee[sd]?", "message": "Don't promise results.", "severity": "warn" }],
  "extensions": [".md", ".mdx", ".tsx"],
  "ignore": ["drafts/**", "*.generated.ts"]
}
```
<!-- honest-ignore-end -->

- `rules`: `"error"`, `"warn"`, `"off"`, or `[severity, options]`. Pattern options are regular expressions, matched case-insensitively.
- `custom`: your own pattern rules. Every match is a finding.
- `extensions`: what a folder scan reads (default: Markdown, text, HTML, JS/TS, JSON and YAML, plus `.astro`, `.vue`, `.svelte`). Files named on the command line are always read.
- `ignore`: globs relative to the working directory. A pattern without `/` matches a name at any depth. `node_modules`, `.git`, `dist`, `build`, `coverage`, `.next`, `.turbo` and `.cache` are always skipped.

### Ignore directives

Write these in any comment syntax. Add rule ids to limit them to those rules, and ` -- reason` to say why.

| Directive | Covers |
| --- | --- |
| `honest-ignore-line [rules]` | its own line |
| `honest-ignore-next-line [rules]` | the next line |
| `honest-ignore-start [rules]` … `honest-ignore-end` | the lines in between |
| `honest-ignore-file [rules]` | the whole file |

### CLI

```text
honest check [paths...]    scan files and folders (default "."); "-" reads standard input
  -c, --config <file>      config file (default ./honest.config.json when present)
  -f, --format <format>    text (default), json, or github (annotations on the pull request)
      --max-warnings <n>   fail when there are more than n warnings
  -q, --quiet              errors only
honest rules               list the rules and their severity under the current config
```

| Exit code | Meaning |
| --- | --- |
| 0 | No errors, and warnings within `--max-warnings` |
| 1 | Errors, or more warnings than `--max-warnings` |
| 2 | Bad arguments or config, or a path that doesn't exist |

In GitHub Actions: `npx honest check docs --format github`.

## API

Everything below is exported from `@senova/honest`.

### Typed results

- **`s`**: schema builders. `s.number({ min, max, integer })` (finite only), `s.string({ pattern, oneOf, minLength })`, `s.boolean()`, `s.literal(value)`, `s.array(item, { minLength, maxLength })`, `s.object(shape, { strict })`, `s.record(value)`, `s.tuple(...items)`, `s.union(...options)`, `s.optional(schema)`, `s.unknown()`.
- **`Infer<typeof schema>`**: the TypeScript type a schema validates.
- **`loadResults(file, schema)`**: reads, parses and validates a JSON file and returns it typed. Throws `ResultsError`, whose `issues` list every problem as `{ path, message }`, for example `methods[2].rms: must be at least 0, got -1`.
- **`parseResults(json, schema, source?)`**: the same for a string.
- **`validateResults(value, schema)`**: returns `{ ok: true, value }` or `{ ok: false, issues }` without throwing.

### Computed wording

All of these throw `RangeError` on NaN or Infinity rather than print them, and compare numbers as printed.

- **`compare(a, b, { better, metric?, against?, unit?, digits?, group?, tolerance? })`**: compares result `a` with baseline `b`. `better` is `"lower"` or `"higher"` and is required. Returns `{ outcome, beats, a, b, change, text }`. `text` is:
  - better, lower is better: `cut the error to 0.21 mm from 0.34 mm`
  - better, higher is better: `raised the score to 91.2 from 88.0`
  - worse: `did not beat the baseline (0.41 mm against 0.34 mm)`
  - prints the same, or within `tolerance`: `matched the baseline (both 0.34 mm)`
- **`describeChange(value, from, { digits?, up?, down?, same?, spaceBeforePercent? })`**: `"12% more"`, `"8% less"` or `"no change"` when it rounds to zero.
- **`percentChange(value, from)`**: `(value − from) / |from| × 100`. Throws when `from` is 0.
- **`times(value, reference, { digits?, style?, less?, more?, same? })`**: `"7.7× less"`, `"7.7 times more"`, or `"about the same"` when the ratio rounds to 1. Both numbers must be positive.
- **`formatNumber(value, { digits?, unit?, group? })`**: fixed digits, no locale, never `-0`.

### Rule-based headlines

- **`pickHeadline(items, { label, score, goal?, where? })`**: the item with the highest (`goal: "max"`, default) or lowest score among those passing `where`. Returns `{ item, index, score, rule }`, or `null` when nothing qualifies. Ties go to the earliest item. A non-finite score throws.
- **`within(value, reference, { pct, better })`**: true when `value` is at most `pct` % worse than `reference`. Anything better passes.

### Claim checker

- **`checkText(text, { file?, config?, rules? })`**: findings for a string. `file` names it and picks sentence splitting: prose for `.md`, `.txt`, `.html` and similar; code (each line ends a sentence) for everything else.
- **`checkPaths(paths, { cwd?, config?, rules? })`**: walks files and folders. Returns `{ findings, files }`, paths relative to `cwd`.
- **`Finding`**: `{ rule, severity, file, line, column, match, message, hint? }`, lines and columns from 1.
- **`loadConfig(file)`**, **`findConfig(cwd)`**, **`validateConfig(value)`**, **`resolveRules(config, extraRules?)`**: read and check config; problems throw `ConfigError`.
- **`ClaimRule`**: `{ id, summary, defaultSeverity, options?, check(doc, options) }`, where `check` returns `{ index, length, message, hint? }` hits. Pass your own in `rules`. `Document` gives rules `text`, `sentences()`, `sentenceAt(index)` and `position(index)`.
- **`BUILTIN_RULES`** and each rule by name: `hype`, `hardwareClaim`, `simulationNote`, `price`, `vendorFigure`, `insecureSource`. **`patternRule(config)`** builds a custom rule.
- **`formatFindings(findings, "text" | "json" | "github", fileCount)`**, **`summarize(findings, fileCount)`**.
- **`run(argv, io)`**: the CLI as a function, returning the exit code (`EXIT.ok`, `EXIT.findings`, `EXIT.usage`).
- **`globToRegExp(glob)`**, **`DEFAULT_EXTENSIONS`**, **`DEFAULT_IGNORE`**, **`DEFAULT_HTTP_ALLOW`**, **`CONFIG_FILE`**.

## Limits

- The claim checker reads words, not meaning. It finds the common forms of each claim, not every one: a determined writer can phrase around it, and an honest sentence can trip it. Use ignore directives with a reason for those, and keep a person reviewing.
- Negation is a word list close to the claim ("not", "never", "no", "nothing", "without", "n't" and a few more). <!-- honest-ignore-line hype --> "No doubt a breakthrough" is skipped as negated; "this breakthrough needs no calibration" is caught.
- Sentence splitting is approximate. Prose splits at `. ! ?` and blank lines; code splits at every line break, so a claim inside a string that spans lines may be split from its label.
- English only.
- `price` can fire on regex replacement strings such as `$1` in source files; ignore the line. <!-- honest-ignore-line price -->
- `vendor-figure` can't know who measured a number. It only asks that a figure next to vendor words is labelled.
- Typed results check shape and ranges, not truth. Pair them with a test that the published results file equals the one your study wrote.
- Nothing here runs or verifies your experiment.

## Dependencies

None at run time. TypeScript and `@types/node` for development (Apache-2.0 and MIT).

## Licence

[AGPL-3.0-or-later](../../LICENSE). Copyright © 2026 Senova Systems LLC and contributors.
