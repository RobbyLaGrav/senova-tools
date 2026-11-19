# Senova Tools

Open-source developer tools from [Senova Systems](https://senovasys.com), built while we design hardware and run research. Each tool is a small, documented package with tests. Use them, change them, ship them, under one rule: **if you distribute a tool or run it for others, publish your code under the same licence** ([AGPL-3.0](LICENSE)).

## The tools

| Tool | What it does | For | Status |
| --- | --- | --- | --- |
| [Seedrun](packages/seedrun) | Run reproducible experiments: fixed seeds, parallel parts, one merged results file | Researchers, ML and simulation work | Ready |
| [Smoothchart](packages/smoothchart) | Tiny SVG charts: monotone smooth lines, hover per line, animation, no dependencies | Web developers, research sites | Ready |
| [Typeset](packages/typeset) | Equation cards rendered at build time: the equation, its symbols, the meaning; never a scrollbar | Technical writers, docs sites | Ready |
| [Honest](packages/honest) | Research pages where the results file writes the charts and the wording, with hype and claim checks | Labs and companies publishing results | Ready |
| [Spikesim](packages/spikesim) | Browser simulation of an event camera feeding leaky integrate-and-fire neurons | Neuromorphic teaching and demos | Ready |
| [Quant8](packages/quant8) | Quantise a small network to 8-bit and generate C to run it on a microcontroller | Embedded ML | Ready |
| [Overflow](packages/overflow) | Audit pages for inner scrollbars, misaligned list columns and titles that wrap | Front-end teams | Ready |
| [Renderpack](packages/renderpack) | CAD renders to web images, with a contact sheet to check before publishing | Hardware companies | Ready |
| [Diskguard](packages/diskguard) | Watch dev-machine disk space and safely clear build caches across worktrees | Anyone running many branches | Ready |
| [Probe](packages/probe) | Bench instruments that stream live, typed measurements to a page, a script or an agent | Hardware engineers, test labs | Ready |
| [Bench](packages/bench) | Hardware-in-the-loop CI: real board tests on every commit, plots in the pull request | Embedded and IoT teams | In progress |
| [Unfold](packages/unfold) | CAD assembly to an interactive 3D product page with exploded views | Companies selling physical products | In progress |
| [Rewind](packages/rewind) | Record an AI request with everything it touched, then replay it exactly | Teams shipping AI features | In progress |

## Quick start

You need [Node.js](https://nodejs.org) 24 or newer.

```sh
git clone https://github.com/RobbyLaGrav/senova-tools.git
cd senova-tools
npm install
npm test          # every tool's tests
npm run check     # types, licence headers and repo rules
```

Each tool's own README has its install line, a two-minute example and its API.

## How this repository is organised

```
packages/<tool>/        one tool per folder: README, src/, test/, examples/
packages/_template/     what a new tool starts from (npm run new-tool -- <name>)
docs/                   architecture, adding a tool, releasing, licensing
scripts/                repo checks and the new-tool generator
.github/                CI, issue and pull request templates
```

Every package follows the same shape and the same rules, so once you know one you know them all. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first. In short: one change per pull request, tests for behaviour, and a `Signed-off-by` line on each commit ([DCO](https://developercertificate.org)). Be kind: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

Found a security problem? Please don't open an issue: see [SECURITY.md](SECURITY.md).

## Licence

Copyright © 2026 Senova Systems LLC. Licensed under the [GNU Affero General Public License v3.0 or later](LICENSE). In plain words, and in [docs/LICENSING.md](docs/LICENSING.md): you may use, study, change and share these tools, including commercially. If you distribute them, or let people use a changed version over a network, you must make your source code available under the same licence.
