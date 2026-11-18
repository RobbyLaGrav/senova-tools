# Contributing

Thanks for helping. This guide keeps the repository easy to follow for everyone.

## Before you start

- **Bug or idea?** Open an issue with the matching template first, so we can agree on the approach before you write code.
- **Small fix** (typo, docs, an obvious bug)? A pull request on its own is fine.

## Set up

```sh
npm install
npm test
npm run check
```

Node.js 24 or newer. TypeScript runs directly through Node's type stripping; no build step is needed for tests.

## Making a change

1. Branch from `main`: `fix/<tool>-<what>` or `feat/<tool>-<what>`.
2. Keep to one tool and one change per pull request.
3. Add or update tests in `packages/<tool>/test/`. A bug fix comes with a test that failed before it.
4. Update the tool's README if behaviour or the API changed, and add a line under "Unreleased" in [CHANGELOG.md](CHANGELOG.md).
5. Every source file starts with the licence header:
   ```ts
   // SPDX-License-Identifier: AGPL-3.0-or-later
   // Copyright (c) 2026 Senova Systems LLC and contributors
   ```
6. Run `npm test` and `npm run check`, then open the pull request using the template.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org): `feat(smoothchart): per-line hover`, `fix(diskguard): skip active dev servers`. Sign off every commit (`git commit -s`), which certifies the [Developer Certificate of Origin](https://developercertificate.org): you wrote the change or have the right to submit it under this project's licence.

## Adding a new tool

`npm run new-tool -- <name>` copies `packages/_template`. Then follow [docs/ADDING-A-TOOL.md](docs/ADDING-A-TOOL.md).

## Standards every tool meets

- Strict TypeScript, no `any` in public APIs.
- No runtime dependencies unless they earn their place, and only with licences compatible with AGPL-3.0 (MIT, BSD, ISC, Apache-2.0).
- Tests with Node's built-in runner (`node:test`).
- A README with: what it does, install, a two-minute example, API, limits.
- Honest docs: say what is measured, simulated or estimated, and what the tool doesn't do.
