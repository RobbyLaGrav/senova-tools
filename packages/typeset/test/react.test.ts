// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
import assert from "node:assert/strict"
import { test } from "node:test"

import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import { FitMath, MathBox, Tex } from "../src/react.ts"

const card = (props: Parameters<typeof MathBox>[0]) => renderToStaticMarkup(createElement(MathBox, props))

test("MathBox renders three separate parts: equation, symbols, plain words", () => {
  const html = card({
    tex: String.raw`E = mc^2`,
    symbols: [
      ["E", "energy"],
      ["m", "mass"],
      ["c", "the speed of light"],
    ],
    explain: "Mass and energy are two forms of the same thing.",
  })
  assert.match(html, /^<figure class="typeset">/)
  assert.match(html, /<div class="typeset-eq"><div class="typeset-eq-inner"><span class="katex-display">/)
  assert.match(html, /<h3 class="typeset-label">Symbols<\/h3>/)
  assert.match(html, /<h3 class="typeset-label">In plain words<\/h3>/)
  assert.match(html, /<p class="typeset-explain">Mass and energy are two forms of the same thing\.<\/p>/)
  assert.equal(html.match(/<div class="typeset-symbol">/g)?.length, 3)
  // Each symbol is typeset (KaTeX, with MathML), not plain text.
  assert.match(html, /<dt><span class="typeset-inline"><span class="katex">.*?<math/)
  assert.match(html, /<dd>the speed of light<\/dd>/)
  // Symbols come before the explanation.
  assert.ok(html.indexOf("Symbols") < html.indexOf("In plain words"))
})

test("MathBox without symbols leaves the Symbols part out", () => {
  const html = card({ tex: "a^2 + b^2 = c^2", explain: "Pythagoras." })
  assert.doesNotMatch(html, /Symbols/)
  assert.doesNotMatch(html, /typeset-symbols/)
  assert.match(html, /In plain words/)
})

test("MathBox labels, heading level, macros and class name are configurable", () => {
  const html = card({
    tex: String.raw`x \in \R`,
    symbols: [[String.raw`\R`, "the real numbers"]],
    explain: "x is a real number.",
    labels: { symbols: "Symboles", explain: "En clair" },
    headingLevel: 4,
    macros: { "\\R": "\\mathbb{R}" },
    className: "wide",
  })
  assert.match(html, /^<figure class="typeset wide">/)
  assert.match(html, /<h4 class="typeset-label">Symboles<\/h4>/)
  assert.match(html, /<h4 class="typeset-label">En clair<\/h4>/)
  assert.doesNotMatch(html, /<h3/)
})

test("bad TeX in the equation or a symbol fails the render (and so the build)", () => {
  assert.throws(() => card({ tex: String.raw`\frac{1}{`, explain: "x" }), /Typeset could not render/)
  assert.throws(() => card({ tex: "x", symbols: [[String.raw`\undefinedthing`, "?"]], explain: "x" }), /Undefined control sequence/)
})

test("Tex renders inline maths in a span", () => {
  const html = renderToStaticMarkup(createElement(Tex, { tex: String.raw`\tau_m`, className: "x" }))
  assert.match(html, /^<span class="typeset-inline x"><span class="katex">/)
  assert.doesNotMatch(html, /katex-display/)
})

test("FitMath wraps pre-rendered HTML without changing it on the server", () => {
  const html = renderToStaticMarkup(createElement(FitMath, { html: "<b>pre-rendered</b>" }))
  assert.equal(html, '<div class="typeset-eq"><div class="typeset-eq-inner"><b>pre-rendered</b></div></div>')
})
