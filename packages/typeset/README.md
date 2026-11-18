# Typeset

Equation cards rendered at build time: the typeset equation, its symbols with their meanings, and the idea in plain words. A long equation shrinks to fit; nothing ever scrolls.

**For:** technical writers, research and docs sites built with React (Next.js, Astro, Remix, any static build). **Status:** in progress.

Each card has three separate parts across the full width:

1. **The equation**, typeset by [KaTeX](https://katex.org) on the server, as HTML for looks and MathML for screen readers. The browser gets finished markup and no maths library.
2. **Symbols**: every symbol typeset beside what it means.
3. **In plain words**: what the equation says, for readers who don't read maths.

Symbols and plain words sit side by side and stack when the card is narrow. A small client helper measures the equation and lowers its font size if it would overflow, so long equations stay on one line without a scrollbar. Rendering is strict: a typo in the TeX throws, which fails your build instead of showing broken maths to readers.

## Install

```sh
npm install @senova/typeset katex react
```

Load KaTeX's stylesheet (it brings the maths fonts), then Typeset's:

```ts
import "katex/dist/katex.min.css"
import "@senova/typeset/typeset.css"
```

## Two-minute example

In a React server component, a static page, or any component rendered at build time:

```tsx
import { MathBox, Tex } from "@senova/typeset/react"

export function Neuron() {
  return (
    <>
      <p>
        Each neuron leaks with time constant <Tex tex={String.raw`\tau_m`} />.
      </p>
      <MathBox
        tex={String.raw`\tau_m \frac{dV}{dt} = -\bigl(V - V_{\text{rest}}\bigr) + R\,I(t)`}
        symbols={[
          ["V", "membrane voltage"],
          [String.raw`\tau_m`, "membrane time constant: how fast the voltage leaks back"],
          [String.raw`V_{\text{rest}}`, "resting voltage"],
          [String.raw`R\,I(t)`, "input current, scaled by the membrane resistance"],
        ]}
        explain="The voltage drifts back to rest on its own and is pushed up by incoming current. Past a threshold, the neuron fires and resets."
      />
    </>
  )
}
```

Run the same card without a framework and print its HTML: `node packages/typeset/examples/card.ts`.

Check every equation in CI, and see all the broken ones at once rather than the first:

```ts
import { formatReport, validateAll } from "@senova/typeset"

const report = validateAll([
  { id: "neuron/leak", tex: String.raw`\tau_m \frac{dV}{dt} = -(V - V_{\text{rest}}) + R\,I(t)` },
  { id: "neuron/typo", tex: String.raw`\fracc{1}{\tau_m}` },
])
console.log(formatReport(report))
// Typeset: 1 of 2 equations failed:
//   neuron/typo: Undefined control sequence: \fracc (at character 0)
//     \fracc{1}{\tau_m}
```

That's `examples/validate.ts`; it exits 1 when anything fails.

## API

### Core: `@senova/typeset` (no React needed)

#### `renderEquation(tex: string, opts?: RenderOptions): string`

Renders TeX to an HTML string containing KaTeX's HTML and MathML. Throws `TypesetError` when:

- the TeX doesn't parse (`\frac{a}{`, `\fracc`, a missing `}`);
- KaTeX's strict mode flags LaTeX-incompatible input (for example accented letters in maths mode, or the `\html*` extensions);
- it uses a command that needs trust: `\href`, `\url`, `\includegraphics`, `\htmlClass` and friends. These are always off. KaTeX on its own would print them in red; Typeset fails instead;
- the TeX is empty.

`RenderOptions`:

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `display` | `boolean` | `true` | Display (block) maths, or inline when `false` |
| `macros` | `Record<string, string>` | none | TeX macros, such as `{ "\\R": "\\mathbb{R}" }`. Copied per call, so `\gdef` in one equation never leaks into the next |

#### `class TypesetError extends Error`

`tex` (the input), `reason` (KaTeX's message on its own) and `position` (zero-based character offset where rendering stopped, or `undefined`). `message` combines them: `Typeset could not render "\\fracc{a}{b}": Undefined control sequence: \fracc`.

#### `validateAll(snippets: Snippet[], opts?: { macros? }): ValidationReport`

Renders every snippet with the same settings as `renderEquation` and never throws. A `Snippet` is a TeX string or `{ id, tex, display? }`. The report is `{ ok, checked, failures }`, and each failure is `{ index, id, tex, message, position }`, in list order.

#### `formatReport(report: ValidationReport): string`

The report as plain text for CI logs, one entry per failure.

#### `fitScale(need: number, room: number, minScale = 0.55): number | null`

The arithmetic behind `<FitMath>`: given an equation's natural width and the room available (pixels), the font-size factor that makes it fit with 2% to spare, never below `minScale`. `null` when it already fits. `DEFAULT_MIN_SCALE` is exported too.

### React: `@senova/typeset/react`

`react` is an optional peer dependency (18 or newer); only this entry point needs it.

#### `<MathBox>`

| Prop | Type | Default | Meaning |
| --- | --- | --- | --- |
| `tex` | `string` | required | The equation, rendered as display maths |
| `explain` | `ReactNode` | required | The "In plain words" text |
| `symbols` | `[tex: string, meaning: ReactNode][]` | `[]` | Each symbol, typeset, beside its meaning. The Symbols part is left out when empty |
| `labels` | `{ symbols?, explain? }` | "Symbols", "In plain words" | Headings, for other languages or wording |
| `headingLevel` | `2` to `6` | `3` | Heading element for those labels, to fit your page outline |
| `macros` | `Record<string, string>` | none | Used for the equation and the symbols |
| `minScale` | `number` | `0.55` | Smallest size a long equation shrinks to |
| `className` | `string` | none | Added to the outer `<figure class="typeset">` |

`<MathBox>` renders its TeX while React renders it, so in a server component or static build bad TeX fails the build. It has no hooks itself; only `<FitMath>` inside it runs in the browser.

#### `<Tex tex macros? className? />`

Inline maths in a `<span class="typeset-inline">`.

#### `<FitMath html minScale? className? />`

The client helper (marked `"use client"`). Wraps already-rendered display maths, measures it after layout, and lowers its font size only if it is wider than the box. It re-fits when the box is resized and after web fonts load. `html` is inserted as-is: pass output from `renderEquation`, never user-supplied HTML.

### Stylesheet: `@senova/typeset/typeset.css`

Theme the cards with these custom properties, on `:root` or any ancestor. The defaults follow the surrounding text colour, so light and dark themes work with nothing set.

| Property | Default | Used for |
| --- | --- | --- |
| `--typeset-ink` | `currentColor` | Equation, symbols, plain-words text |
| `--typeset-muted` | `currentColor` at 68% | Headings and symbol meanings |
| `--typeset-line` | `currentColor` at 14% | Card borders and symbol dividers |
| `--typeset-surface` | `currentColor` at 5% | Background behind the equation |
| `--typeset-radius` | `16px` | Corner radius of the three parts |
| `--typeset-gap` | `14px` | Space between the parts |
| `--typeset-eq-size` | `clamp(1.05em, 1.6vw, 1.32em)` | Equation size before any fitting |
| `--typeset-symbol-size` | `17px` | Each typeset symbol |
| `--typeset-meaning-size` | `14px` | Each symbol's meaning |
| `--typeset-text-size` | `15.5px` | Plain-words text |
| `--typeset-label-size` | `12px` | The "Symbols" and "In plain words" headings |

Class names: `typeset`, `typeset-eq`, `typeset-eq-inner`, `typeset-parts`, `typeset-card` (plus `typeset-card-symbols` / `typeset-card-explain`), `typeset-label`, `typeset-symbols`, `typeset-symbol`, `typeset-explain`, `typeset-inline`. Layout uses container queries on the card: the lower parts stack under 640px of card width, and symbols go to one column under 420px.

## Limits

- **Your TeX, not your visitors'.** Typeset is built for equations written by the site's authors. KaTeX escapes text and links are off, but KaTeX's own expansion and size limits are the only guard against very large input.
- **Shrinking has a floor.** An equation that would need to go below `minScale` (55% by default) to fit is clipped at the card's edge rather than scrolled. Split it across lines with `aligned` or `split` instead.
- **Fitting needs JavaScript.** Without it, cards still render and read correctly; a very long equation is clipped instead of shrunk.
- **What's tested.** Node tests cover rendering, every error path, `validateAll`, the fit arithmetic and the React markup on the server. The browser-side measuring in `<FitMath>` is not covered by automated tests: the arithmetic it uses is.
- **KaTeX, not LaTeX.** Only what [KaTeX supports](https://katex.org/docs/supported). Strict mode rejects some things LaTeX accepts with a warning, such as accented letters in maths mode: write `\acute{e}` or move the word into `\text{}`.

## Dependencies

| Package | Licence | Why |
| --- | --- | --- |
| [katex](https://github.com/KaTeX/KaTeX) | MIT | Typesetting |
| [commander](https://github.com/tj/commander.js) (via katex) | MIT | KaTeX's command-line tool; not used by Typeset |
| [react](https://react.dev) (optional peer) | MIT | Only for `@senova/typeset/react` |

Development only: `react-dom` (MIT) to render the components in tests, and `@types/react`, `@types/react-dom` (MIT).

## Licence

[AGPL-3.0-or-later](../../LICENSE). Copyright © 2026 Senova Systems LLC and contributors.
