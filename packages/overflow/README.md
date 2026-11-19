# Overflow

Audit pages for inner scrollbars, sideways page scroll, misaligned list and table columns, titles that wrap and clipped text, from a layout snapshot you can check anywhere.

**For:** front-end teams who want layout regressions caught in review or CI, at every viewport, without a visual-diff service. **Status:** in progress (0.x: the API may still change before 1.0).

It works in two halves:

- **A collector** that runs in the page (from Playwright or Puppeteer `page.evaluate`, the DevTools console, or a bookmarklet) and returns a JSON **snapshot**: every rendered element's tag, selector path, box, scroll and client sizes, computed overflow, white-space, font size, line height and text, plus the words on each line of every title.
- **A rule engine** in plain Node that reads the snapshot and reports findings. The rules never touch a browser, so they are fast, deterministic and tested with hand-built snapshots.

| Rule | Reports | Default |
| --- | --- | --- |
| `inner-scrollbar` | A box with `overflow: auto` or `scroll` whose content is bigger than the box, so it scrolls inside the page. Skips `html` and `body` (the page scroller) and `allowScroll` selectors. `overflow: scroll` with nothing to scroll is reported as info (an empty scrollbar track on systems with classic scrollbars). | warning |
| `page-overflow-x` | The page is wider than the viewport and scrolls sideways, plus the outermost elements that stick out past the edge (the right edge, or the left in RTL), largest first. Elements inside a clipping or scrolling box and fixed elements are not blamed; `visibility: hidden` elements are, because they still take space. | error |
| `column-misaligned` | Rows of a list or table (`tr`, `li`, `role="row"`/`"listitem"`, or same-class siblings built from divs) whose cells' start edges (left, or right in RTL) differ by more than `tolerance.column` from the column's median. Stacked rows (phone layouts), side-by-side cards, `colspan` rows and hidden rows are left out. | warning |
| `title-wraps` | `h1`-`h6`, `role="heading"` and `titleSelectors` that take more than `maxTitleLines` lines. Lines are the collector's measurement; without one they are estimated from height and line height, and the finding says so. | warning |
| `title-widow` | A title of three or more words that leaves one word alone on its last line (skipped when `text-wrap` is `balance` or `pretty`). | info |
| `text-clipped` | Text in a box with `overflow: hidden` or `clip` whose content is bigger than the box. With `text-overflow: ellipsis` (horizontal) or `line-clamp` (vertical) the cut is deliberate and reported as info. | warning |

Elements with `display: none` are never recorded; `visibility: hidden` and zero-size elements are skipped by every rule except `page-overflow-x`.

## Install

```sh
npm install @senova/overflow
```

Not on npm yet: until it is, clone this repository and run `npm install` at its root. Node.js 24 or newer. No dependencies; you bring the browser automation you already use, or none at all.

## Two-minute example

**1. Take a snapshot.** With Playwright (Puppeteer is the same), once per viewport you care about:

```ts
import { chromium } from "playwright"
import { writeFileSync } from "node:fs"
import { collectorExpression } from "@senova/overflow"

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 375, height: 812 } })
await page.goto("http://127.0.0.1:3000/")
const snapshot = await page.evaluate(collectorExpression({ label: "mobile" }))
writeFileSync("mobile.json", JSON.stringify(snapshot))
await browser.close()
```

`page.evaluate(collectLayout, { label: "mobile" })` works too: the function is self-contained, so Playwright and Puppeteer can send it as it is.

Without automation: run `npx overflow collector`, paste the output into the DevTools console inside `copy(...)` (Chrome and Firefox) to put the snapshot on the clipboard. Or run `npx overflow collector --bookmarklet`, save the output as a bookmark's URL, and click it on any page to download `overflow-snapshot.json`.

**2. Check it.** This repository has a sample snapshot of a 375 px wide page and a config that allows scrolling code blocks ([`examples/`](examples)):

```json
{
  "allowScroll": ["pre", "textarea", "select"],
  "maxTitleLines": 2,
  "tolerance": { "column": 2 },
  "failOn": "warning"
}
```

```sh
cd packages/overflow/examples
node ../src/bin.ts check sample-snapshot.json --config overflow.config.json   # npx overflow check ... in your project
```

```
http://127.0.0.1:3000/ at 375x812 (mobile): 2 errors, 4 warnings, 2 info in 20 elements

ERROR   page-overflow-x  html
        the page is 37 px wider than the viewport and scrolls sideways; 1 element sticks out
        fix: Fix the elements named below; overflow-x: hidden on body hides the symptom and can break position: sticky.

ERROR   page-overflow-x  html > body > table.usage
        sticks out 37 px past the right edge of the viewport
        fix: Common causes: a fixed width or min-width, 100vw (it includes the scrollbar), long unbroken text or URLs (overflow-wrap: anywhere), wide images or tables without max-width: 100%.

WARNING title-wraps  html > body > h1.hero-title
        title wraps to 3 lines (limit 2): "Audit every page before your users do"
        ...

WARNING inner-scrollbar  html > body > nav.sidebar
        scrolls inside the page: content 640 px tall in a 200 px box

WARNING column-misaligned  html > body > ul.team > li:nth-of-type(2) > span.role
        column 2 of 3 rows in html > body > ul.team: 1 row starts up to 14 px from the others

WARNING text-clipped  html > body > div.card > p.card-body
        text is clipped: 48 px cut off at the bottom: "Three scroll boxes inside the settings page trap the mous..."

INFO    title-widow  html > body > h1.hero-title
        title leaves one word, "do", alone on its last line: "Audit every page before your users do"

INFO    text-clipped  html > body > div.card > h3.card-title
        truncated: 109 px cut off on the right (with an ellipsis): "Weekly report: scroll containers and layout shifts"
```

The full output is [`examples/sample-report.txt`](examples/sample-report.txt) (the tests check it), and [`examples/check-sample.ts`](examples/check-sample.ts) does the same through the API. The command exits 1 because there are findings at or above `warning`. `--format markdown` gives a table for a pull request comment; `--format json` gives the report itself.

## CLI

```
overflow check <snapshot.json...>   check one or more snapshots (one per viewport, say)
overflow collector                  print the in-page collector as a JavaScript expression
overflow collector --bookmarklet    print it as a javascript: bookmark that downloads the snapshot

-c, --config <file>      JSON config (tolerances, ignore and allowScroll selectors, rule severities)
    --fail-on <level>    exit 1 when a finding is at or above: info, warning (default), error, never
-f, --format <format>    text (default), markdown or json
    --label <name>       viewport label for reports (check) or the snapshot (collector)
```

Exit codes: 0 no findings at or above `--fail-on` (or the config's `failOn`), 1 there are, 2 a usage mistake or a bad snapshot or config. With several snapshots, `--format json` prints an array of reports.

## Config

Every field is optional. Unknown fields are refused, so a typo can't silently leave a default in place.

| Field | Default | Meaning |
| --- | --- | --- |
| `viewportLabel` | the snapshot's | Label for the viewport in reports. |
| `ignore` | `[]` | Selectors whose elements, and everything inside them, every rule skips. |
| `allowScroll` | `["textarea", "select"]` | Scroll boxes that are intended (code blocks, carousels, data grids). Setting it replaces the default. |
| `titleSelectors` | `[]` | Extra titles besides `h1`-`h6` and `role="heading"`, for example `.card-title`. |
| `maxTitleLines` | `2` | Lines a title may take before `title-wraps`. |
| `tolerance.column` | `2` | Pixels a column's start edge may differ between rows. |
| `tolerance.overflow` | `1` | Pixels of overflow ignored before a box counts as scrolling or clipped (sub-pixel rounding). |
| `tolerance.page` | `1` | Pixels the page may be wider than the viewport. |
| `maxCulprits` | `5` | Elements named as the cause of sideways page scroll. |
| `minRows` | `3` | Rows a list needs before its columns are compared. |
| `rules` | see the rule table | `{ "rule-id": "info" \| "warning" \| "error" \| "off" }`. Deliberate cases (ellipsis, line-clamp, empty `overflow: scroll`) stay info. |
| `failOn` | `"warning"` | Lowest severity that makes `overflow check` exit 1; `"never"` always exits 0. |

Selectors support tag, `*`, `#id`, `.class`, `[attr]`, `[attr=v]`, `~=`, `^=`, `$=`, `*=`, `:nth-of-type(n)`, descendant and `>` combinators, and comma lists: enough to paste a reported selector straight into `ignore`. Anything else (`:hover`, `+`, `~`) is refused with an error rather than matching nothing.

## API

### `check(snapshot: unknown, config?: Config | ResolvedConfig): Report`

Validates the snapshot (it may come straight from `JSON.parse`), resolves the config, runs every rule and returns the report: `{ overflow: 1, url?, viewport: { width, height, label? }, truncated, elements, counts: { error, warning, info }, findings }`. Findings are ordered errors first, then page order. Each finding is `{ rule, severity, selector, message, measured, hint? }`; `measured` holds the numbers it is based on (pixels or lines), for example `{ axis: "y", scrollHeight: 640, clientHeight: 200, ... }`. Throws `InputError` for a bad snapshot or config.

### `fails(report, failOn): boolean` and `atLeast(severity, threshold): boolean`

Whether a report has a finding at or above a severity (`"never"` is always false), and the severity comparison it uses.

### `formatText(report): string` and `formatMarkdown(report): string`

The terminal view (one block per finding, with its fix) and a Markdown section with a table (pipes, backticks and newlines escaped).

### Collector: `collectLayout(options?)`, `collectorExpression(options?)`, `bookmarklet(options?)`, `COLLECTOR_SOURCE`

`collectLayout` runs in a browser and returns a `Snapshot`; it uses only its argument and browser globals. `COLLECTOR_SOURCE` is its source text, `collectorExpression(options)` an expression that calls it (for `page.evaluate(string)` or the console), and `bookmarklet(options)` a `javascript:` URL that downloads `overflow-<label>.json`. Options (`CollectOptions`):

| Option | Default | Meaning |
| --- | --- | --- |
| `maxElements` | `20000` | Stop after this many elements and mark the snapshot `truncated` (reports say so). |
| `textLimit` | `200` | Longest text kept per element. |
| `titleSelectors` | `[]` | Extra selectors whose lines are measured (headings, `role="heading"` and classes containing "title" or "heading" always are). |
| `label` | none | Viewport label written into the snapshot. |
| `fullUrl` | `false` | Keep the query string and hash in `url`; by default they are dropped, as they often carry tokens. |

The collector skips `head`, `script`, `style`, `template` and `display: none` subtrees, and doesn't look inside `svg`, `iframe`, `canvas`, media and form controls. Selector paths start at the nearest element with a unique id.

### Snapshots: `validateSnapshot(value)`, `parseSnapshot(json)`, `InputError`, `MAX_ELEMENTS`

The snapshot format (`Snapshot`, `SnapshotElement` in [`src/types.ts`](src/types.ts)): `{ overflow: 1, url?, takenAt?, viewport, document: { scrollWidth, scrollHeight, clientWidth, clientHeight }, direction?, truncated?, elements }`. Each element names its `parent` by index (parents come first), with `tag`, `selector`, `rect` (document coordinates), scroll and client sizes, `overflowX`/`overflowY`, `whiteSpace`, `fontSize`, `lineHeight` (px), and optional `id`, `classes`, `attrs`, `nth`, `display`, `position`, `direction`, `visible`, `textOverflow`, `lineClamp`, `textWrap`, `colSpan`, `text`, `lines`. Validation refuses unknown fields, non-finite numbers, forward parent references and more than `MAX_ELEMENTS` (200,000) elements; `InputError.path` names the bad field (`elements[12].rect.width`). Write your own snapshots by hand for tests the same way.

### Config: `resolveConfig(config?)`, `parseConfig(json)`, `DEFAULT_CONFIG`, `DEFAULT_RULES`, `RULE_IDS`, `SEVERITIES`

Validate a config and fill in defaults, as described under Config.

### Selectors: `parseSelector(source)`, `matches(list, elements, index)`

The selector matcher used for `ignore`, `allowScroll` and `titleSelectors`, over snapshot elements.

## Limits

- A snapshot is one viewport at one moment: take one per breakpoint, and after the content you care about has loaded. Hover states, open menus and animations are only seen if the page is in that state when the collector runs.
- Rects are recorded at the current scroll position plus `scrollX`/`scrollY`; take snapshots scrolled to the top-left for the most reliable `page-overflow-x` culprits.
- Pseudo-elements (`::before`, `::after`), margins and transforms that widen the page are not elements in the snapshot; the page finding says when no element explains the overflow.
- Column alignment is a heuristic: it compares start edges only, needs `minRows` rows with the same number of cells, and only looks at direct children of a row. Rows built from mismatched tags or nested wrappers may be missed.
- Title lines come from the browser's text ranges; words are whitespace-separated runs, so a widow check never fires for text without spaces (for example Chinese or Japanese), and line counts fall back to height divided by line height when ranges are unavailable.
- Shadow DOM contents and iframes are not walked.
- `text-clipped` can report boxes that hide decorative overflow on purpose; put them in `ignore`.
- Tested against hand-built snapshots and a fake DOM in Node; the collector has not yet been run in this repository's tests against a real browser engine.

## Dependencies

None at runtime. Development uses the repository's TypeScript and `@types/node`.

## Licence

[AGPL-3.0-or-later](../../LICENSE). Copyright © 2026 Senova Systems LLC and contributors.
