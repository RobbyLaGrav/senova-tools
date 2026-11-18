// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// The README's two-minute example: one equation card, rendered to static HTML the way a server component or a static
// build would. Run it with:  node packages/typeset/examples/card.ts
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import { MathBox } from "../src/react.ts"

const html = renderToStaticMarkup(
  createElement(MathBox, {
    tex: String.raw`\tau_m \frac{dV}{dt} = -\bigl(V - V_{\text{rest}}\bigr) + R\,I(t)`,
    symbols: [
      [String.raw`V`, "membrane voltage"],
      [String.raw`\tau_m`, "membrane time constant: how fast the voltage leaks back"],
      [String.raw`V_{\text{rest}}`, "resting voltage"],
      [String.raw`R\,I(t)`, "input current, scaled by the membrane resistance"],
    ],
    explain: "The voltage drifts back to rest on its own and is pushed up by incoming current. Past a threshold, the neuron fires and resets.",
  }),
)

console.log(html)
