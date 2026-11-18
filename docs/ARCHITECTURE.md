# Architecture

One repository, many small tools. Each tool is an npm workspace package under `packages/`, with the same shape and the same rules, so a reader who knows one knows them all.

## A package

```
packages/<tool>/
  README.md          what it does, install, two-minute example, API, limits, dependencies and their licences
  package.json       name "@senova/<tool>", "license": "AGPL-3.0-or-later", "type": "module", exports
  src/index.ts       the public API (everything exported here is documented in the README)
  src/*.ts           internals, one concern per file
  test/*.test.ts     node:test tests, run straight from TypeScript
  examples/          small runnable examples used in the README
  CHANGELOG.md       per-tool history (Keep a Changelog format)
```

## Shared rules

- **Language:** TypeScript, strict (`tsconfig.base.json`), ES modules, Node.js 24+. Node runs `.ts` directly, so tests need no build. `npm run build` emits JavaScript and type declarations for publishing.
- **Tests:** `node:test` and `node:assert/strict`. No test framework to install.
- **Dependencies:** as few as possible; only AGPL-compatible licences ([LICENSING.md](LICENSING.md)).
- **Headers:** every source file starts with the SPDX header; `npm run check` enforces it.
- **Honesty:** docs say what is measured, simulated or estimated. Examples run.

## Repository checks (`npm run check`)

| Check | Script |
| --- | --- |
| Types across all packages | `tsc -b` |
| SPDX licence header on every source file | `scripts/check-headers.mjs` |
| Every package has README, package.json (AGPL licence field), src/index.ts and at least one test | `scripts/check-packages.mjs` |

## Continuous integration

`.github/workflows/ci.yml` runs install, tests and checks on every pull request and on `main`, with actions pinned to commit hashes.
