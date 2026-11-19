// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Makes the README example files: a 4 -> 16 relu -> 8 relu -> 3 softmax classifier for three noisy clusters of
// 4-value sensor readings, trained here with plain gradient descent and a fixed seed, plus calibration and test sets.
// Run: node examples/make-example.ts   (writes examples/gesture/*.json; the committed files came from this script)
import { mkdirSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

// Small seeded generator (mulberry32) so the files are the same on every machine.
let state = 12345
const rand = () => {
  state = (state + 0x6d2b79f5) | 0
  let t = Math.imul(state ^ (state >>> 15), 1 | state)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand())
const r4 = (x: number) => Math.round(x * 1e4) / 1e4

const centres = [
  [1.2, -0.4, 0.3, 2.0],
  [-0.8, 1.5, -1.0, 0.5],
  [0.2, 0.1, 1.8, -1.2],
]
const sample = (n: number) => {
  const inputs: number[][] = []
  const labels: number[] = []
  for (let i = 0; i < n; i++) {
    const c = i % 3
    inputs.push(centres[c]!.map((m) => r4(m + 0.6 * gauss())))
    labels.push(c)
  }
  return { inputs, labels }
}

const sizes = [4, 16, 8, 3]
const W = sizes.slice(1).map((out, l) => Array.from({ length: out }, () => Array.from({ length: sizes[l]! }, () => gauss() * Math.sqrt(2 / sizes[l]!))))
const B = sizes.slice(1).map((out) => new Array<number>(out).fill(0))

const forward = (x: number[]) => {
  const acts = [x]
  W.forEach((w, l) => {
    const y = w.map((row, o) => row.reduce((s, v, i) => s + v * acts[l]![i]!, B[l]![o]!))
    acts.push(l < W.length - 1 ? y.map((v) => Math.max(0, v)) : y)
  })
  return acts
}

const train = sample(300)
for (let epoch = 0; epoch < 60; epoch++) {
  train.inputs.forEach((x, s) => {
    const acts = forward(x)
    const logits = acts.at(-1)!
    const m = Math.max(...logits)
    const e = logits.map((v) => Math.exp(v - m))
    const sum = e.reduce((a, b) => a + b, 0)
    let delta = e.map((v, i) => v / sum - (i === train.labels[s] ? 1 : 0))
    for (let l = W.length - 1; l >= 0; l--) {
      const prev = acts[l]!
      const back = prev.map((_, i) => W[l]!.reduce((acc, row, o) => acc + row[i]! * delta[o]!, 0))
      W[l]!.forEach((row, o) => {
        row.forEach((_, i) => (row[i]! -= 0.01 * delta[o]! * prev[i]!))
        B[l]![o]! -= 0.01 * delta[o]!
      })
      delta = back.map((d, i) => (prev[i]! > 0 ? d : 0))
    }
  })
}

const model = {
  inputSize: 4,
  softmax: true,
  layers: W.map((w, l) => ({ weights: w.map((row) => row.map(r4)), bias: B[l]!.map(r4), activation: l < W.length - 1 ? "relu" : "none" })),
}
const dir = fileURLToPath(new URL("./gesture/", import.meta.url))
mkdirSync(dir, { recursive: true })
writeFileSync(dir + "model.json", JSON.stringify(model) + "\n")
writeFileSync(dir + "calib.json", JSON.stringify(sample(60)) + "\n")
writeFileSync(dir + "test.json", JSON.stringify(sample(150)) + "\n")
console.log(`wrote ${dir}model.json, calib.json, test.json`)
