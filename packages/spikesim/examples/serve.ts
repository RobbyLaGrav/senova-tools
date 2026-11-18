// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Serves the browser example at http://127.0.0.1:5178 with no build step: TypeScript files under src/ are sent as
// JavaScript after Node strips their types. Run it with: npm run example:browser -w @senova/spikesim
// Local development only: it listens on 127.0.0.1 and serves nothing outside this package's examples/ and src/.
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { stripTypeScriptTypes } from "node:module"
import { extname, join, normalize, sep } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const allowed = [join(root, "examples") + sep, join(root, "src") + sep]
const port = Number(process.env.PORT ?? 5178)
const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".ts": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" }

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname)
  const file = normalize(join(root, path === "/" ? "examples/index.html" : path))
  const type = types[extname(file)]
  if (!type || !allowed.some((dir) => file.startsWith(dir))) {
    res.writeHead(404).end("Not found")
    return
  }
  try {
    const text = await readFile(file, "utf8")
    res.writeHead(200, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" })
    res.end(extname(file) === ".ts" ? stripTypeScriptTypes(text) : text)
  } catch {
    res.writeHead(404).end("Not found")
  }
})
server.listen(port, "127.0.0.1", () => console.log(`Spikesim example: http://127.0.0.1:${port}`))
