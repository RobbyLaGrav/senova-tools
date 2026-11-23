// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Bench: hardware-in-the-loop tests with results for CI and the pull request.
export { BenchError, type BenchErrorCode } from "./errors.ts"
export { LineBuffer, describePattern, type LineHit, type LinePattern, type WaitOptions } from "./lines.ts"
export { CommandBoard, checkBoardName, checkLine, runCommand, type Board, type CommandBoardOptions, type CommandSpec, type ConsoleSpec } from "./board.ts"
export { SimBoard, type SimBoardOptions, type SimFaults } from "./sim.ts"
export { runBench, type BenchEvent, type BenchTest, type MeasureOptions, type RunOptions, type TestContext } from "./runner.ts"
export { parseRun, runPassed, stringifyRun, STATUSES, type BenchRun, type Measurement, type RunMeta, type TestResult, type TestStatus } from "./results.ts"
export { acquireBoardLock, type LockOptions } from "./lock.ts"
export { cell, compareRuns, fence, toJunit, toMarkdown, type CompareOptions, type DiffStatus, type MarkdownOptions, type MeasurementDiff } from "./report.ts"
export { main, USAGE, type BenchConfig, type CliIo } from "./cli.ts"
