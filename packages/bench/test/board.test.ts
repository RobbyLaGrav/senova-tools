// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// CommandBoard against real child processes (node itself stands in for a flasher) and a TCP server standing in for
// a ser2net console bridge.
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createServer, type Server, type Socket } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"

import { CommandBoard, runBench, runCommand } from "../src/index.ts"

const dir = mkdtempSync(join(tmpdir(), "bench-board-"))
after(() => rmSync(dir, { recursive: true, force: true }))
const node = process.execPath

/** A fake board console: prints a boot line to each new client and answers "ping". */
async function fakeConsole(): Promise<{ server: Server; port: number; clients: Socket[] }> {
  const clients: Socket[] = []
  const server = createServer((s) => {
    clients.push(s)
    s.write("boot fw ok\r\n")
    s.on("data", (d) => {
      for (const line of d.toString().split("\n").filter(Boolean)) s.write(line === "ping" ? "pong\r\n" : "err unknown\r\n")
    })
  })
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
  const address = server.address()
  return { server, port: typeof address === "object" && address ? address.port : 0, clients }
}

test("runCommand passes arguments exactly, with no shell, and substitutes {image}", async () => {
  const out = join(dir, "args.json")
  const tricky = "fw; echo pwned $(whoami) & | > x.bin"
  await runCommand({ command: node, args: ["-e", "require('fs').writeFileSync(process.argv[1], JSON.stringify(process.argv.slice(2)))", out, "{image}", "{unknown}"] }, { image: tricky })
  assert.deepEqual(JSON.parse(readFileSync(out, "utf8")), [tricky, "{unknown}"])
})

test("runCommand reports a failing exit with its output, a timeout, and a missing program", async () => {
  await assert.rejects(
    runCommand({ command: node, args: ["-e", "console.log('erasing'); console.error('Error: target not found'); process.exit(3)"] }),
    (e: Error & { code: string }) => e.code === "COMMAND_FAILED" && /exited with 3/.test(e.message) && /target not found/.test(e.message),
  )
  await assert.rejects(runCommand({ command: node, args: ["-e", "setTimeout(() => {}, 10000)"], timeoutMs: 200 }), /timed out after 200 ms/)
  await assert.rejects(runCommand({ command: join(dir, "no-such-flasher") }), (e: Error & { code: string }) => e.code === "COMMAND_FAILED" && /could not start/.test(e.message))
})

test("a CommandBoard flashes with its command, reads its TCP console and sends lines", async () => {
  const c = await fakeConsole()
  const flashed = join(dir, "flashed.txt")
  const board = new CommandBoard({
    name: "devkit-1",
    flash: { command: node, args: ["-e", "require('fs').writeFileSync(process.argv[1], process.argv[2])", flashed, "{image}"] },
    reset: { command: node, args: ["-e", ""] },
    console: { host: "127.0.0.1", port: c.port },
  })
  try {
    const run = await runBench({
      board,
      image: "build/fw.bin",
      tests: [
        { name: "boots", run: async (t) => void (await t.waitFor("boot fw ok")) },
        { name: "ping", run: async (t) => { await t.send("ping"); await t.waitFor("pong", { timeoutMs: 1000 }) } },
      ],
    })
    assert.equal(run.passed, true, JSON.stringify(run.tests))
    assert.equal(readFileSync(flashed, "utf8"), "build/fw.bin")
    assert.equal(c.clients.length, 1, "one console connection for the whole run")
  } finally {
    await board.close()
    for (const s of c.clients) s.destroy()
    c.server.close()
  }
})

test("console problems and bad options are clear errors", async () => {
  const noConsole = new CommandBoard({ name: "b1" })
  await assert.rejects(noConsole.send("ping"), { code: "BOARD" })
  await assert.rejects(noConsole.flash("fw.bin"), /has no flash command/)
  await noConsole.reset() // no reset command: nothing to do

  const c = await fakeConsole()
  c.server.close() // nothing listening any more
  await new Promise((r) => setTimeout(r, 20))
  const dead = new CommandBoard({ name: "b2", console: { host: "127.0.0.1", port: c.port, connectTimeoutMs: 500 } })
  await assert.rejects(dead.send("ping"), { code: "BOARD" })
  await dead.close()
  await assert.rejects(dead.send("ping"), { code: "CLOSED" })

  assert.throws(() => new CommandBoard({ name: "../etc" }), { code: "INVALID_ARGUMENT" })
  assert.throws(() => new CommandBoard({ name: "b", flash: { command: "" } }), { code: "INVALID_ARGUMENT" })
  assert.throws(() => new CommandBoard({ name: "b", console: { host: "x", port: 70000 } }), { code: "INVALID_ARGUMENT" })
  await assert.rejects(new CommandBoard({ name: "b", console: { host: "127.0.0.1", port: 1 } }).send("two\nlines"), { code: "INVALID_ARGUMENT" })
})
