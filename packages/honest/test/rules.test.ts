// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Each built-in rule fires on what it is for, and stays quiet on honest text that looks similar.
import assert from "node:assert/strict"
import { test } from "node:test"

import { checkText, type HonestConfig } from "../src/index.ts"

/** Rule ids and matched text for each finding of one rule. */
const hits = (rule: string, text: string, config: HonestConfig = {}, file?: string): string[] =>
  checkText(text, file === undefined ? { config } : { config, file }).filter((f) => f.rule === rule).map((f) => f.match)

const fires = (rule: string, text: string, config?: HonestConfig, file?: string) =>
  assert.ok(hits(rule, text, config, file).length > 0, `${rule} should fire on: ${text}`)
const quiet = (rule: string, text: string, config?: HonestConfig, file?: string) =>
  assert.deepEqual(hits(rule, text, config, file), [], `${rule} should stay quiet on: ${text}`)

test("hype fires on each hype word", () => {
  for (const t of [
    "A breakthrough in sensing.",
    "Our first-ever controller.",
    "The world's first levitating stage.",
    "A first of its kind design.",
    "This will revolutionize robotics.",
    "A game-changing result.",
    "The method is proven.",
    "State-of-the-art accuracy.",
    "We beat SOTA.",
    "Unprecedented speed.",
    "Best-in-class latency.",
    "A groundbreaking study.",
    "Industry-leading efficiency.",
  ])
    fires("hype", t)
})

test("hype stays quiet on negations, other words and honest wording", () => {
  quiet("hype", "The method is not proven on real data.")
  quiet("hype", "It has never been a breakthrough, just a careful study.")
  quiet("hype", "This is unproven.")
  quiet("hype", "The first experiment ran for an hour.")
  quiet("hype", "We cut the error to 0.21 mm from 0.34 mm.")
  // a negation further away than three words doesn't excuse a claim
  fires("hype", "No calibration was needed for this breakthrough.")
})

test("hype options add and allow words", () => {
  fires("hype", "An epic result.", { rules: { hype: ["error", { add: ["epic"] }] } })
  quiet("hype", "The method is proven.", { rules: { hype: ["error", { allow: ["proven"] }] } })
})

test("hardware-claim fires on claims of measurement on hardware", () => {
  for (const t of [
    "We measured it on our chip.",
    "Accuracy was verified on real hardware.",
    "Results were tested on the prototype.",
    "Bench measurements show a 3x saving.",
    "Hardware results confirm the model.",
    "The measured power was 3 mW.",
  ])
    fires("hardware-claim", t)
})

test("hardware-claim stays quiet on simulation notes and negations", () => {
  quiet("hardware-claim", "Nothing here was measured on hardware.")
  quiet("hardware-claim", "It has not been measured on hardware yet.")
  quiet("hardware-claim", "Nothing has been built, tested or measured on hardware.")
  quiet("hardware-claim", "The design will be measured on hardware yet to be built.")
  quiet("hardware-claim", "All results come from simulation.")
  quiet("hardware-claim", "We measured the error in simulation.")
})

test("hardware-claim: a negation in another sentence does not excuse a claim", () => {
  fires("hardware-claim", "This is not a toy. We measured it on our chip.")
})

test("simulation-note is off by default and requires a note when on", () => {
  quiet("simulation-note", "The error fell to 0.2 mm.")
  const on: HonestConfig = { rules: { "simulation-note": "error" } }
  fires("simulation-note", "The error fell to 0.2 mm.", on)
  quiet("simulation-note", "The error fell to 0.2 mm. All results are simulated.", on)
  quiet("simulation-note", "Nothing has been measured on hardware.", { rules: { "simulation-note": ["error", { pattern: "measured on hardware" }] } })
})

test("price fires on money amounts and price talk with numbers", () => {
  for (const t of ["It costs $499.", "Around €1,200 per unit.", "£30k a year.", "Priced at 99 USD.", "EUR 40 each.", "A 50 dollar kit.", "US$ 12 shipped.", "The price is 40 a unit."]) fires("price", t)
})

test("price stays quiet on template strings, energy costs and allowed amounts", () => {
  quiet("price", "const s = `${value} mm`", {}, "a.ts")
  quiet("price", "Each inference costs 40 operations.")
  quiet("price", "The price of accuracy is latency.")
  quiet("price", "Match group \\$1 in the regex.")
  quiet("price", "It is free ($0).", { rules: { price: ["error", { allow: ["^\\$0$"] }] } })
})

test("vendor-figure fires on unlabelled vendor, datasheet and press-release figures", () => {
  for (const t of [
    "The vendor quotes 12 TOPS/W.",
    "The datasheet lists 3 mW at 1 V.",
    "Its press release claims 20x faster inference.",
    "The manufacturer rates it at 5 A.",
    "The chip is advertised at 100 fps.",
  ])
    fires("vendor-figure", t)
  fires("vendor-figure", "Acme Corp reports 9 pJ per spike.", { rules: { "vendor-figure": ["error", { vendors: ["Acme Corp"] }] } })
})

test("vendor-figure stays quiet when labelled, without figures, or in another sentence", () => {
  quiet("vendor-figure", "The vendor quotes 12 TOPS/W (vendor figure).")
  quiet("vendor-figure", "Vendor figures: 12 TOPS/W.")
  quiet("vendor-figure", "The manufacturer's own figure is 5 A.")
  quiet("vendor-figure", "From the datasheet: 3 mW at 1 V.")
  quiet("vendor-figure", "The vendor did not publish efficiency.")
  quiet("vendor-figure", "In its 2024 press release the company announced the chip.")
  quiet("vendor-figure", "See the vendor page at https://example.net/v2/spec3.")
  quiet("vendor-figure", "We talked to the vendor. Our error was 0.2 mm.")
  quiet("vendor-figure", "Acme Corp reports 9 pJ per spike.") // not a configured vendor name
  quiet("vendor-figure", "Acme Corp reports 9 pJ (unverified).", { rules: { "vendor-figure": ["error", { vendors: ["Acme Corp"] }] } })
})

test("insecure-source fires on plain-http links and stays quiet on https and local addresses", () => {
  assert.deepEqual(hits("insecure-source", "See http://example.net/paper.pdf."), ["http://example.net/paper.pdf"])
  fires("insecure-source", '<a href="http://journal.org/x">x</a>', {}, "page.html")
  quiet("insecure-source", "See https://example.net/paper.pdf.")
  quiet("insecure-source", "Run it at http://localhost:3000 or http://127.0.0.1:8080.")
  quiet("insecure-source", '<svg xmlns="http://www.w3.org/2000/svg"></svg>', {}, "a.svg")
  quiet("insecure-source", "Served from http://app.test/ and http://api.localhost:4000/.")
  quiet("insecure-source", "Mirror: http://mirror.internal/x", { rules: { "insecure-source": ["error", { allow: ["http://mirror.internal/"] }] } })
})

test("custom pattern rules from config", () => {
  const config: HonestConfig = { custom: [{ id: "no-guarantee", pattern: "guarantee[sd]?", message: "Don't promise results.", severity: "warn" }] }
  const f = checkText("We guarantee a 2x saving.", { config })
  assert.equal(f.length, 1)
  assert.equal(f[0]?.rule, "no-guarantee")
  assert.equal(f[0]?.severity, "warn")
  assert.equal(f[0]?.message, '"guarantee": Don\'t promise results.')
})

test("severity can be lowered to warn or switched off per rule", () => {
  assert.equal(checkText("A breakthrough.", { config: { rules: { hype: "warn" } } })[0]?.severity, "warn")
  assert.deepEqual(checkText("A breakthrough.", { config: { rules: { hype: "off" } } }), [])
})
