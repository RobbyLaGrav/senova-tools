# Seedrun

Run reproducible experiments with fixed seeds, split into parts that run side by side, and merge them into one results file.

**For:** researchers, ML and simulation work: anyone publishing numbers that someone else should be able to re-run and get byte for byte. **Status:** ready (0.x: the API may still change before 1.0).

- **Fixed seeds.** One base seed per experiment. Each part gets its own seed, derived from the base seed and the part's name, so parts never share a random stream and adding a part never moves another part's numbers.
- **Parts side by side.** `seedrun run --all` runs every part in its own Node process, one per core. Each part writes `out/<part>.json`; you can also run parts on different machines and copy the files back.
- **One results file.** `seedrun merge` combines the parts in the order the config declares them, refusing missing or stale parts.
- **Same seed, same bytes.** Output is canonical JSON (sorted keys, fixed layout, no timestamps or timings), and `Math.random()` is blocked inside parts. `seedrun verify` re-runs a part and checks the bytes match.

## Install

```sh
npm install @senova/seedrun
```

Not on npm yet: until it is, clone this repository and run `npm install` at its root. Node.js 24 or newer; TypeScript configs run directly.

## Two-minute example

A config file declares the experiment: a name, a seed and its parts. Each part receives `ctx.rng`, a seeded generator, and returns plain JSON data. This is [`examples/monte-carlo/seedrun.config.ts`](examples/monte-carlo/seedrun.config.ts) (which imports from `../../src/index.ts` so it runs inside this repository):

```ts
import { defineExperiment, percentile, round } from "@senova/seedrun"

export default defineExperiment({
  name: "monte-carlo",
  seed: 2026,
  parts: {
    // Estimate pi from random points in the unit square.
    pi: ({ rng, log }) => {
      const n = 1_000_000
      let inside = 0
      for (let i = 0; i < n; i++) {
        const x = rng.next(), y = rng.next()
        if (x * x + y * y < 1) inside++
      }
      log(`${n} points`)
      return { points: n, pi: round((4 * inside) / n, 5) }
    },
    // How far 1,000 random walks of 1,000 unit steps end up from the start.
    walks: ({ rng }) => {
      const distances: number[] = []
      for (let w = 0; w < 1000; w++) {
        let x = 0, y = 0
        for (let s = 0; s < 1000; s++) {
          const angle = rng.uniform(0, 2 * Math.PI)
          x += Math.cos(angle)
          y += Math.sin(angle)
        }
        distances.push(Math.hypot(x, y))
      }
      return { walks: 1000, steps: 1000, median: round(percentile(distances, 50), 2), p95: round(percentile(distances, 95), 2) }
    },
  },
  merge: ({ pi, walks }) => ({ pi, walks, note: "Simulated with seeded draws; re-running gives the same bytes." }),
})
```

Run it from the example's folder (in your own project, `npx seedrun` replaces `node ../../src/bin.ts`):

```sh
cd packages/seedrun/examples/monte-carlo
node ../../src/bin.ts run --all     # both parts side by side -> out/pi.json, out/walks.json
node ../../src/bin.ts merge         # -> results.json
node ../../src/bin.ts verify --all  # re-runs each part and compares the bytes with out/
```

```
running 2 parts, 2 side by side
[pi] 1000000 points
pi: wrote out/pi.json in 0.05 s (sha256 f18898a24e1d)
walks: wrote out/walks.json in 0.12 s (sha256 313db23af4d8)
merged 2 parts into results.json (sha256 364f7602388a)
```

`results.json` is the same on every run and every machine we tested (see Limits):

```json
{
  "experiment": "monte-carlo",
  "parts": {
    "pi": 3744696576,
    "walks": 1270891698
  },
  "results": {
    "note": "Simulated with seeded draws; re-running gives the same bytes.",
    "pi": {
      "pi": 3.14114,
      "points": 1000000
    },
    "walks": {
      "median": 25.33,
      "p95": 54.13,
      "steps": 1000,
      "walks": 1000
    }
  },
  "seed": 2026,
  "seedrun": 1
}
```

`parts` records each part's seed, so anyone can re-run one part alone. The test suite pins this file's SHA-256 (`364f7602…`).

## CLI

```
seedrun list                       the parts in the config, with their seeds
seedrun run <part...>              run these parts and write out/<part>.json for each
seedrun run --all                  run every part
seedrun merge                      combine the partial files into results.json
seedrun verify <part...> | --all   run each part twice and check the bytes match (and match out/ if present)

-c, --config <file>   config file (default: seedrun.config.ts, .mts, .mjs or .js in this folder)
-j, --jobs <n>        parts to run side by side, each in its own process (default: one per core, at most one per part)
    --out <dir>       partial files directory (default: from the config, "out" next to it)
    --results <file>  merged results file (default: from the config, "results.json" next to it)
```

Exit codes: 0 success, 1 a part, merge or verify failed, 2 a usage mistake.

## API

### Experiments: `@senova/seedrun`

#### `defineExperiment(config: ExperimentConfig): Experiment`

Validates a config and fills in defaults; use it as the config file's default export. Throws a `TypeError` or `RangeError` that names the problem.

| Field | Type | Meaning |
| --- | --- | --- |
| `name` | `string` | Written into every output file. |
| `seed` | `number` | Base seed, an integer from 0 to 2^32 − 1. |
| `parts` | `Record<string, PartSpec>` | Named parts (letters, digits, `-`, `_`; `all` is reserved). A part is `(ctx) => result` or `{ run, seed?, description? }`; `seed` fixes that part's seed instead of deriving it. Parts may be `async`. |
| `merge?` | `(results, info) => unknown` | Shapes the merged results from `{ [part]: result }`. Default: that map as it is. May be `async`. |
| `version?` | `string` | Bump it when code changes the results; partial files from another version are refused at merge. |
| `outDir?` | `string` | Partial files folder, relative to the config file. Default `out`. |
| `resultsFile?` | `string` | Merged file, relative to the config file. Default `results.json`. |
| `allowMathRandom?` | `boolean` | Let parts call `Math.random()`. Default `false`: it throws inside parts. |

A part receives `PartContext`: `experiment`, `part`, `seed` (this part's seed), `rng` (a generator from that seed) and `log(message)` (to stderr, prefixed with the part name; never written into results). It returns plain JSON data: objects, arrays, strings, finite numbers, booleans, `null`, or typed arrays (written as arrays).

#### `runPart(experiment, name, { outDir, log? }): Promise<PartRun>`

Runs one part and writes `<outDir>/<name>.json` atomically (temporary file, then rename). Returns `{ part, seed, json, sha256, seconds, file }`. `seconds` is reported only, never written.

#### `computePart(experiment, name, { log? }): Promise<PartOutput>`

The same, in memory, without writing.

#### `mergeParts(experiment, { outDir, resultsFile? }): Promise<MergeOutput>`

Reads every part's file and combines them in config order. Writes `resultsFile` if given. Returns `{ json, sha256, results, file }`. Rejects when a part is missing (naming the `seedrun run` command to fix it), or a file came from another experiment, seed or version.

#### `loadConfig(file): Promise<LoadedConfig>` and `findConfig(cwd?): string`

Import a config file and resolve its `outDir` and `resultsFile` against the file's folder; `findConfig` looks for the names in `CONFIG_NAMES`. A config file is code and runs with your permissions: only load configs you trust.

#### `partialPath(outDir, part): string`

Where a part's file goes.

### Seeds: `@senova/seedrun`

#### `createRng(seed: number): Rng`

A mulberry32 generator. Same seed, same sequence, everywhere.

| Method | Returns |
| --- | --- |
| `next()` | float in [0, 1) |
| `uniform(lo, hi)` | float in [lo, hi) |
| `int(lo, hi)` | integer in [lo, hi) |
| `normal(mean = 0, sd = 1)` | normal draw (Box-Muller) |
| `shuffle(array)` | the array, shuffled in place (Fisher-Yates) |
| `pick(array)` | one element |
| `fork(label)` | an independent generator for a sub-task, from this generator's seed and the label (not its position) |

#### `deriveSeed(seed: number, label: string): number`

The seed for a label under a base seed (FNV-1a and the murmur3 finaliser). This is how parts get their seeds. Its output is pinned by tests and won't change.

### Output: `@senova/seedrun`

- `stableStringify(value): string`: canonical JSON (sorted keys, two-space indent, trailing newline, `-0` as `0`). Throws, naming the path, for `NaN`, `Infinity`, `bigint`, functions, `undefined` in arrays, and non-plain objects (`Map`, `Set`, `Date`, class instances), instead of changing them silently as `JSON.stringify` does.
- `sha256(text): string`: hex digest.
- `mean(values)`, `rms(values)`, `percentile(values, p)` (nearest rank, p from 0 to 100), `round(value, digits = 3)`.

File formats (both carry `"seedrun": 1`): a partial file holds `experiment`, `version?`, `experimentSeed`, `part`, `seed`, `result`; the results file holds `experiment`, `version?`, `seed`, `parts` (part → seed) and `results`. Types: `PartialFile`, `ResultsFile`.

### Small networks: `@senova/seedrun/ml`

Dependency-free helpers for small reproducible studies, ported unchanged from the research code Seedrun came from (tests check they give the original's numbers bit for bit).

- `mlp(sizes, { seed = 1, activation = "tanh" | "relu" }): Network`: a dense network, e.g. `[52, 64, 64, 2]`. Hidden layers use the activation; the output is linear. Weights are seeded normal draws (LeCun scale for tanh, He for relu).
- `train(net, X, Y, { epochs = 25, batch = 32, lr = 2e-3, lrDecay = 0.88, seed = 7 }): number[]`: Adam on mean squared error, in place, with seeded shuffling. Returns the loss per epoch.
- `forward(net, x): Float64Array[]` (every layer's output) and `predict(net, x): Float64Array`.
- `scaler(rows): Scaler`: column means and standard deviations, with `apply(row)` and `invert(row)`.
- `leastSquares(X, Y, ridge = 1e-6): Float64Array[]` and `applyLinear(B, x): number[]`: ridge-regularised linear fit by Gauss-Jordan elimination. Add a column of ones for an intercept.
- `mean`, `rms`, `percentile`, `round`, re-exported.

Fitting sin(3x) with 16 hidden units ([`examples/small-network.ts`](examples/small-network.ts); run it with `node examples/small-network.ts`):

```ts
import { createRng } from "@senova/seedrun"
import { mlp, train, predict } from "@senova/seedrun/ml"

const rng = createRng(3)
const X = Array.from({ length: 256 }, () => [rng.uniform(-1, 1)])
const Y = X.map(([x]) => [Math.sin(3 * x!)])
const net = mlp([1, 16, 1], { seed: 5 })
const curve = train(net, X, Y, { epochs: 60, batch: 8, lr: 1e-2, lrDecay: 0.95 })
console.log(curve.at(-1), predict(net, [0.5])[0], Math.sin(1.5)) // 0.00618 0.938 0.997: same digits on every run
```

## Limits

- **What "same bytes" covers.** Measured: the example and the test suite give identical files across repeated runs, across one-process and side-by-side runs, and between the TypeScript sources and the built JavaScript, on Node.js 24 on Windows 11; CI runs the same pinned-hash tests on Linux. Seedrun controls the random draws and the JSON layout. It can't control everything else a part does: reading the clock, the network or unsorted directory listings, iterating a `Set` built in a varying order, or summing floats in a different order. Keep parts pure functions of `ctx`.
- **Maths functions.** ECMAScript doesn't require `Math.sin`, `Math.exp` and similar to be bit-exact. V8 (Node.js) uses the same implementation on every operating system, so results match across machines on one Node.js version; another engine or a future V8 could differ in the last bits. `seedrun verify` tells you when a saved file no longer matches.
- **Stale results.** Merge refuses files made with another seed or `version`, but it can't see code changes. Bump `version` when you change what a part computes, or re-run every part before merging.
- **Parts are independent.** A part can't read another part's result. Work that feeds later work belongs in one part (or in `merge`, if it's cheap).
- **Not a scheduler.** Side-by-side runs are local processes. For several machines, run named parts on each and copy the `out/` files together before `merge`.
- **Not cryptographic.** mulberry32 is for simulation, not for keys or tokens. Its period is 2^32 per stream, so give long runs several parts or `fork`ed streams.
- **The ml helpers are small.** Plain loops on the CPU, one row at a time: fine for thousands of rows and networks of a few thousand weights, slow beyond that. No GPU, no automatic differentiation.
- **Config files are code.** `seedrun` imports the config and runs it with your permissions.

## Dependencies

None at runtime: only Node.js built-ins (`node:fs`, `node:path`, `node:crypto`, `node:child_process`, `node:util`, `node:os`, `node:url`).

## Licence

[AGPL-3.0-or-later](../../LICENSE). Copyright © 2026 Senova Systems LLC and contributors.
