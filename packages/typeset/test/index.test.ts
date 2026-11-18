// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
import assert from "node:assert/strict"
import { test } from "node:test"

import { fitScale, formatReport, renderEquation, TypesetError, validateAll } from "../src/index.ts"

const LIF = String.raw`\tau_m \frac{dV}{dt} = -(V - V_{\text{rest}}) + R\,I(t)`

test("valid TeX renders HTML for looks and MathML for screen readers", () => {
  const html = renderEquation(LIF)
  assert.match(html, /class="katex-display"/)
  assert.match(html, /class="katex-html"/)
  assert.match(html, /<math xmlns="http:\/\/www\.w3\.org\/1998\/Math\/MathML" display="block">/)
  assert.match(html, /<annotation encoding="application\/x-tex">/)
})

test("display: false renders inline maths", () => {
  const html = renderEquation(String.raw`\alpha + \beta`, { display: false })
  assert.doesNotMatch(html, /katex-display/)
  assert.match(html, /<math [^>]*>/)
  assert.doesNotMatch(html, /display="block"/)
})

test("invalid TeX throws a TypesetError naming the TeX, the reason and the position", () => {
  assert.throws(
    () => renderEquation(String.raw`\frac{a}{`),
    (err: unknown) => {
      assert.ok(err instanceof TypesetError)
      assert.equal(err.tex, String.raw`\frac{a}{`)
      assert.match(err.reason, /Unexpected end of input/)
      assert.equal(err.position, 9)
      assert.ok(err.message.startsWith(String.raw`Typeset could not render "\\frac{a}{": `))
      return true
    },
  )
  assert.throws(() => renderEquation(String.raw`\fracc{a}{b}`), /Undefined control sequence: \\fracc/)
  assert.throws(() => renderEquation("x^{2"), /Expected '\}', got 'EOF'/)
})

test("strict mode turns LaTeX-incompatible input into an error", () => {
  assert.throws(() => renderEquation("x é y"), /unicodeTextInMathMode/)
  assert.throws(() => renderEquation(String.raw`\htmlClass{a}{b}`), /htmlExtension/)
})

test("links, images and HTML are never trusted, and fail instead of printing in red", () => {
  assert.throws(() => renderEquation(String.raw`\href{javascript:alert(1)}{x}`), /\\href is not allowed/)
  assert.throws(() => renderEquation(String.raw`\url{https://example.com}`), /\\url is not allowed/)
})

test("empty TeX is an error", () => {
  assert.throws(() => renderEquation(""), /the TeX is empty/)
  assert.throws(() => renderEquation("   "), /the TeX is empty/)
})

test("macros apply, and \\gdef in one equation never leaks into the next", () => {
  const macros = { "\\R": "\\mathbb{R}" }
  assert.match(renderEquation(String.raw`x \in \R`, { macros }), /mathbb/)
  assert.deepEqual(macros, { "\\R": "\\mathbb{R}" })
  renderEquation(String.raw`\gdef\leak{1}\leak`, { macros })
  assert.deepEqual(macros, { "\\R": "\\mathbb{R}" })
  assert.throws(() => renderEquation(String.raw`\leak`, { macros }), /Undefined control sequence: \\leak/)
})

test("validateAll reports exactly which snippets failed, with ids, positions and reasons", () => {
  const report = validateAll([
    LIF,
    { id: "neuron/threshold", tex: String.raw`V \ge V_{\text{th}}` },
    { id: "neuron/reset", tex: String.raw`V \leftarrow V_{\text{reset}` },
    String.raw`\fracc{1}{2}`,
    { id: "inline", tex: String.raw`\alpha`, display: false },
  ])
  assert.equal(report.ok, false)
  assert.equal(report.checked, 5)
  assert.deepEqual(
    report.failures.map((f) => [f.index, f.id]),
    [
      [2, "neuron/reset"],
      [3, undefined],
    ],
  )
  assert.match(report.failures[0]!.message, /Expected '\}'/)
  assert.equal(report.failures[1]!.message, String.raw`Undefined control sequence: \fracc`)
  assert.equal(report.failures[1]!.position, 0)

  const text = formatReport(report)
  assert.match(text, /^Typeset: 2 of 5 equations failed:/)
  assert.match(text, /neuron\/reset: Expected/)
  assert.match(text, /#3: Undefined control sequence: \\fracc \(at character 0\)/)
})

test("validateAll passes a clean list and an empty one", () => {
  const report = validateAll([LIF, String.raw`E = mc^2`])
  assert.deepEqual(report, { ok: true, checked: 2, failures: [] })
  assert.equal(formatReport(report), "Typeset: all 2 equations render.")
  assert.deepEqual(validateAll([]), { ok: true, checked: 0, failures: [] })
})

test("fitScale leaves fitting equations alone and shrinks wide ones, never below the minimum", () => {
  assert.equal(fitScale(300, 400), null)
  assert.equal(fitScale(400, 400), null)
  assert.equal(fitScale(0, 400), null)
  assert.equal(fitScale(500, 0), null)
  assert.ok(Math.abs(fitScale(500, 400)! - 0.784) < 1e-9)
  assert.ok(fitScale(500, 400)! * 500 < 400, "leaves a little spare room")
  assert.equal(fitScale(800, 400), 0.55)
  assert.equal(fitScale(2000, 400, 0.3), 0.3)
})
