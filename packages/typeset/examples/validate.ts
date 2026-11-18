// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Check every equation on a site in CI and list all the broken ones at once. One snippet here is broken on purpose,
// so this exits 1 and shows the report. Run it with:  node packages/typeset/examples/validate.ts
import { formatReport, validateAll } from "../src/index.ts"

const equations = [
  { id: "neuron/leak", tex: String.raw`\tau_m \frac{dV}{dt} = -(V - V_{\text{rest}}) + R\,I(t)` },
  { id: "neuron/fire", tex: String.raw`V \ge V_{\text{th}} \Rightarrow V \leftarrow V_{\text{reset}}` },
  { id: "neuron/typo", tex: String.raw`\fracc{1}{\tau_m}` },
]

const report = validateAll(equations)
console.log(formatReport(report))
process.exitCode = report.ok ? 0 : 1
