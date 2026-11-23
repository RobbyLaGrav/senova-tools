# Bench

Hardware-in-the-loop CI: flash a real board on every commit, run tests against it, and post the measurements as a table and charts in the pull request.

**For:** embedded and IoT teams who want board tests in CI next to their unit tests, without a hosted test farm. **Status:** in progress (0.x: the API may change before 1.0).

- **Boards behind one interface.** `flash(image)`, `reset()`, a line-based console and `send(line)`. `CommandBoard` drives a real board with your own flash and reset commands (OpenOCD, esptool, picotool, a relay script) and reads its serial console over TCP (ser2net, a lab console server). `SimBoard` is a seeded simulated board, so the example and the tests run without hardware.
- **Tests that measure.** Each test gets the board, `waitFor(pattern)` on the console, and `measure(name, value, { unit, min, max })`. A reading outside its limits fails the test and is still recorded. Every test has a timeout, and the board is reset between tests unless you say otherwise.
- **One board, one job.** A lock file per board stops two CI jobs from flashing the same board at once. A lock left by a crashed job is taken over once it is stale and its process is gone.
- **Results CI understands.** A typed JSON results file, JUnit XML for the CI test tab, and a Markdown report for the pull request: pass/fail per test, each measurement against the base branch, a Mermaid line chart per measurement across recent runs, and the console tail of anything that failed.
- **A command.** `bench run bench.config.ts` locks the board, runs, and writes all three files; `bench report` rebuilds them from saved results.

## Install

```sh
npm install @senova/bench
```

Not on npm yet: until it is, clone this repository and run `npm install` at its root. Node.js 24 or newer; the TypeScript sources run directly.

## Two-minute example

[`examples/sim.ts`](examples/sim.ts) flashes a simulated board, checks that it boots, answers on its console and holds its 3.3 V rail, then writes the results and the pull-request report. It imports from `../src/index.ts` so it runs inside this repository; outside it, import from `@senova/bench`.

```ts
import { runBench, SimBoard, toJunit, toMarkdown, type BenchTest } from "@senova/bench"

const board = new SimBoard({ name: "devkit-1", seed: 42, rails: { "3v3": 3.3, vbat: 3.95 } })

const tests: BenchTest[] = [
  { name: "boots", run: async (t) => void (await t.waitFor(/^boot \S+ ok$/)) },
  {
    name: "console answers",
    run: async (t) => {
      await t.waitFor(/^boot \S+ ok$/)
      await t.send("ping")
      await t.waitFor("pong", { timeoutMs: 500 })
    },
  },
  {
    name: "3v3 rail",
    run: async (t) => {
      await t.waitFor(/^boot \S+ ok$/)
      await t.send("rail 3v3")
      const line = await t.waitFor(/^rail 3v3 \S+$/)
      t.measure("3v3", Number(line.split(" ")[2]), { unit: "V", min: 3.2, max: 3.4 })
    },
  },
]

const run = await runBench({ board, image: "build/firmware.bin", tests, meta: { commit: "a1b2c3d", branch: "feat/adc" } })
console.log(run.passed ? "all passed" : "failed") // all passed
console.log(toMarkdown(run)) // paste-ready pull-request report
console.log(toJunit(run)) // for the CI test tab
await board.close()
```

Run it from `packages/bench`:

```sh
node examples/sim.ts out
```

It writes `out/bench-results.json`, `out/junit.xml` and `out/bench-report.md`. Add `--fault` to see a rail out of limits reported with its console tail.

## In CI

Put the board on a machine that runs a self-hosted CI runner, and describe it in a config file:

```ts
// bench.config.ts
import { CommandBoard, type BenchConfig } from "@senova/bench"

export default {
  board: new CommandBoard({
    name: "devkit-1",
    flash: { command: "openocd", args: ["-f", "board/devkit.cfg", "-c", "program {image} verify reset exit"], timeoutMs: 60_000 },
    reset: { command: "openocd", args: ["-f", "board/devkit.cfg", "-c", "init; reset run; exit"] },
    console: { host: "127.0.0.1", port: 7001 }, // ser2net in raw mode on the board's serial port
  }),
  image: "build/firmware.bin",
  tests: [/* as above */],
} satisfies BenchConfig
```

Then, in a GitHub Actions job on that runner:

```yaml
- run: npx bench run bench.config.ts --out bench-out --baseline baseline/bench-results.json --history history
- run: gh pr comment ${{ github.event.pull_request.number }} --body-file bench-out/bench-report.md
  if: always() && github.event_name == 'pull_request'
  env: { GH_TOKEN: "${{ github.token }}" }
```

Keep the `bench-results.json` from main builds (as a build artifact or in a branch) and pass it as `--baseline`, and a folder of recent ones as `--history`, to get the comparison column and the charts.

**Self-hosted runners and public repositories:** a self-hosted runner runs whatever code the pull request contains, on the machine wired to your board. On a public repository, run board jobs only for trusted branches or after a maintainer approves the run, never automatically on pull requests from forks.

## The report

The Markdown report starts with a heading (`Bench on devkit-1: passed`) and one line (`3/3 passed in 103 ms, commit a1b2c3d, image build/firmware.bin.`), then:

- a table of tests with status and time;
- a table of measurements: value, limits, base-branch value and change, with `out of limits` or `changed` called out;
- one Mermaid `xychart-beta` line chart per measurement over the history runs and this one (GitHub renders Mermaid blocks in Markdown; elsewhere they show as code);
- for each test that did not pass, its message and the last console lines, in a collapsed section.

Console text comes from the board, so the report puts it in code fences longer than any backtick run inside it and escapes table cells, so device output can't break the layout.

## API

Everything throws `BenchError` with a stable `code`: `INVALID_ARGUMENT`, `TIMEOUT`, `BOARD`, `COMMAND_FAILED`, `LOCKED`, `BAD_RESULTS`, `CLOSED`.

### `runBench(options) → Promise<BenchRun>`

| Option | Default | |
| --- | --- | --- |
| `board` | required | a `Board` |
| `tests` | required | `BenchTest[]`: `{ name, run(t), timeoutMs?, skip? }`; names must be unique |
| `image` | none | passed to `board.flash`; without it the board is only reset |
| `timeoutMs` | `30000` | per test, unless the test sets its own |
| `resetBetween` | `true` | reset the board before every test after the first |
| `meta` | `{}` | `{ commit?, branch?, [key]: string }`, copied into the results |
| `consoleTail` | `40` | console lines kept with each test that did not pass |
| `signal` | none | an `AbortSignal`; tests not yet started are skipped |
| `onEvent` | none | `(e) => void` for `flash`, `test-start`, `test-end` and `measurement` events |

If flashing (or the first reset) fails, every test is reported as `error` with that message and nothing runs. Tests run one at a time, in order.

The test context `t`:

- `board`: the `Board`.
- `waitFor(pattern, { timeoutMs = 5000 }?) → Promise<string>`: resolves with the first console line that matches the string (whole line) or `RegExp`, looking at lines since the previous match, or else since just before the test's reset (for the first test, just before flashing), so boot lines printed while the flash or reset program is still running are not missed. Throws `TIMEOUT` naming the pattern.
- `send(line)`: writes one line to the board console.
- `measure(name, value, { unit?, min?, max? }?)`: records a number. Non-finite values and readings outside `[min, max]` fail the test when it ends; every reading is kept.
- `check(condition, message)`: fails the test at the end with `message` when `condition` is false.
- `log(message)`: adds a line to the test's notes.
- `signal`: aborted when the test times out or the run is aborted, so long waits can stop early.

`BenchRun` is `{ version: 1, board, image?, meta, startedAt, durationMs, passed, tests: TestResult[] }`. `TestResult` is `{ name, status: "pass" | "fail" | "error" | "timeout" | "skip", durationMs, message?, measurements, notes, consoleTail }`; each measurement is `{ name, value, unit?, min?, max?, ok }`. `fail` is a failed check or limit, `error` is a thrown exception. A run passes when no test failed, errored or timed out.

### Boards

`Board` is `{ name, flash(image), reset(), console: LineBuffer, send(line), close() }`. Implement it for anything not covered here.

`new CommandBoard({ name, flash?, reset?, console? })`

- `flash` and `reset` are `{ command, args?, cwd?, env?, timeoutMs? = 120000 }`. `{image}` in any argument is replaced by the image path. Commands run without a shell, so arguments are passed exactly as written and nothing in them is interpreted. A non-zero exit, a timeout or a missing program throws `COMMAND_FAILED` with the last lines of its output. Without `reset`, `reset()` does nothing.
- `console` is `{ host, port, connectTimeoutMs? = 3000 }`: a raw TCP stream of the board's serial port. It connects on first use (and before flashing, so boot lines aren't missed) and splits on `\n`, dropping a trailing `\r`. Without it, `send` throws `BOARD`.

`new SimBoard({ name?, seed?, rails?, noise?, bootMs?, faults? })`: a deterministic simulated board. After `flash` or `reset` it prints `boot <image> ok` after `bootMs` (default 20). It answers `ping` with `pong`, `rail <name>` with `rail <name> <volts>` (the configured value plus seeded noise, default ±0.005 V), `version` with the flashed image, and anything else with `err unknown`. `faults`: `bootFails` (prints `boot failed`), `railOffset: { [rail]: volts }`, `silent` (never answers), `flashFails`.

### `LineBuffer`

The console behind every board: `push(text)` (splits lines, keeps the last 2000), `lines`, `tail(n)`, `mark()`, and `waitFor(pattern, { timeoutMs?, since?, signal? }) → Promise<{ line, index }>`.

### Lock

`acquireBoardLock(name, { dir = os.tmpdir(), waitMs = 0, staleMs = 3600000, pollMs = 250 }?) → Promise<() => Promise<void>>`. Creates `bench-<name>.lock` exclusively and returns the release function. If the lock is held it waits up to `waitMs`, then throws `LOCKED` naming the holder's pid and start time. A lock older than `staleMs` whose process no longer exists on this machine is removed and taken.

### Reports

- `toJunit(run) → string`: JUnit XML, one `<testcase>` per test, measurements as `<property>`s.
- `toMarkdown(run, { baseline?, history?, title?, tolerance? }?) → string`: the pull-request report. `history` is earlier `BenchRun`s, oldest first; the last 20 and this run are charted.
- `compareRuns(run, baseline, { tolerance? }?) → MeasurementDiff[]`: each measurement with its baseline value, change, and `status`: `new`, `same`, `changed` or `out-of-limits`. `tolerance` is relative (default `0.02`, so 2%).
- `parseRun(json) → BenchRun`: validates a results file; throws `BAD_RESULTS` saying which field is wrong.

### `bench` command

```
bench run <config.ts> [--out dir] [--baseline file] [--history dir] [--lock-wait seconds] [--lock-dir dir] [--image path]
bench report <results.json> [--baseline file] [--history dir] [--out dir]
```

`run` imports the config (its default export: `{ board, tests, image?, timeoutMs?, resetBetween?, meta? }`), takes the board lock, runs, and writes `bench-results.json`, `junit.xml` and `bench-report.md` to `--out` (default `bench-out`). `meta.commit` and `meta.branch` default to `GITHUB_SHA` and `GITHUB_HEAD_REF` (or `GITHUB_REF_NAME`) when set. `report` writes `junit.xml` and `bench-report.md` from a saved results file. Exit codes: 0 all passed, 1 a test did not pass, 2 bad input or the board was locked.

## Limits

- Bench does not talk to serial ports directly: that needs native modules. Bridge the port to TCP (ser2net, socat, a console server), or implement `Board` with a serial library you trust.
- It does not post to GitHub or hold any token; your CI posts the Markdown file (for example with `gh pr comment`).
- Tests run one at a time on one board. To use several boards, run one job per board.
- `SimBoard` is for wiring up tests; its readings are generated, not measured.
- The lock only coordinates jobs on the same machine (or sharing the lock folder).
- The config file is code and runs with the CI job's rights; treat it like the rest of your repository.

## Dependencies

None at runtime.

## Licence

[AGPL-3.0-or-later](../../LICENSE). Copyright © 2026 Senova Systems LLC and contributors.
