// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// React components, imported from "@senova/typeset/react". <MathBox> and <Tex> render their TeX while React renders
// them, so in a server component or a static build the browser receives finished HTML and MathML and no KaTeX.
// Bad TeX throws, which fails the build. Only <FitMath> (inside <MathBox>) runs in the browser, to shrink long
// equations to fit. Written with createElement rather than JSX so Node runs the tests straight from TypeScript.
//
// A card is three separate parts across the full width: the equation on its own, then "Symbols" (each symbol
// typeset beside its meaning) and "In plain words". On narrow cards the two lower parts stack.
import { createElement, type ReactElement, type ReactNode } from "react"

import { FitMath } from "./fit-math.ts"
import { renderEquation, type RenderOptions } from "./render.ts"

export { FitMath, type FitMathProps } from "./fit-math.ts"

/** A symbol and what it means: `["\\tau", "the membrane time constant"]`. The first item is TeX. */
export type SymbolEntry = readonly [tex: string, meaning: ReactNode]

/** Props for {@link Tex}. */
export interface TexProps {
  /** The TeX to typeset inline. */
  readonly tex: string
  /** Macros passed to KaTeX. */
  readonly macros?: RenderOptions["macros"]
  readonly className?: string
}

/** Inline maths inside running text. */
export function Tex({ tex, macros, className }: TexProps): ReactElement {
  const html = renderEquation(tex, { display: false, ...(macros && { macros }) })
  return createElement("span", { className: join("typeset-inline", className), dangerouslySetInnerHTML: { __html: html } })
}

/** Props for {@link MathBox}. */
export interface MathBoxProps {
  /** The equation, in TeX. Rendered as display maths. */
  readonly tex: string
  /** The symbols in the equation, each typeset beside its meaning. The "Symbols" part is left out when empty. */
  readonly symbols?: readonly SymbolEntry[]
  /** What the equation says, in plain words. */
  readonly explain: ReactNode
  /** Headings for the two lower parts. Default "Symbols" and "In plain words". */
  readonly labels?: { readonly symbols?: string; readonly explain?: string }
  /** Heading level for those headings. Default 3. */
  readonly headingLevel?: 2 | 3 | 4 | 5 | 6
  /** Macros passed to KaTeX, for the equation and the symbols. */
  readonly macros?: RenderOptions["macros"]
  /** Smallest scale a long equation shrinks to. Default 0.55. */
  readonly minScale?: number
  readonly className?: string
}

/** An equation card: the typeset equation, its symbols and their meanings, and the idea in plain words. */
export function MathBox(props: MathBoxProps): ReactElement {
  const { tex, symbols = [], explain, labels = {}, headingLevel = 3, macros, minScale, className } = props
  const m = macros ? { macros } : {}
  const h = `h${headingLevel}`
  const label = (text: string) => createElement(h, { className: "typeset-label" }, text)

  const symbolCard =
    symbols.length > 0 &&
    createElement(
      "div",
      { className: "typeset-card typeset-card-symbols" },
      label(labels.symbols ?? "Symbols"),
      createElement(
        "dl",
        { className: "typeset-symbols" },
        symbols.map(([sym, meaning], i) =>
          createElement(
            "div",
            { key: i, className: "typeset-symbol" },
            createElement("dt", null, createElement(Tex, { tex: sym, ...m })),
            createElement("dd", null, meaning),
          ),
        ),
      ),
    )

  const explainCard = createElement(
    "div",
    { className: "typeset-card typeset-card-explain" },
    label(labels.explain ?? "In plain words"),
    createElement("p", { className: "typeset-explain" }, explain),
  )

  return createElement(
    "figure",
    { className: join("typeset", className) },
    createElement(FitMath, { html: renderEquation(tex, { display: true, ...m }), ...(minScale !== undefined && { minScale }) }),
    createElement("div", { className: "typeset-parts" }, symbolCard || null, explainCard),
  )
}

const join = (base: string, extra: string | undefined) => (extra ? `${base} ${extra}` : base)
