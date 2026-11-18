// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// A tiny static server for the example page (no dependencies). Serves this package's folder on 127.0.0.1 only.
// Run: npm run example -w @senova/smoothchart   (builds dist/ first), then open http://127.0.0.1:4178/examples/

import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { extname, join, normalize, sep } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const port = Number(process.env.PORT ?? 4178)
const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json",
}

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname)
  const file = normalize(join(root, path.endsWith("/") ? `${path}index.html` : path))
  // only files inside the package folder, and only the types above
  if (req.method !== "GET" || !file.startsWith(root.endsWith(sep) ? root : root + sep) || !types[extname(file)]) {
    res.writeHead(404).end("Not found")
    return
  }
  try {
    const body = await readFile(file)
    res.writeHead(200, { "content-type": types[extname(file)] as string, "cache-control": "no-store" }).end(body)
  } catch {
    res.writeHead(404).end("Not found")
  }
}).listen(port, "127.0.0.1", () => console.log(`Smoothchart example: http://127.0.0.1:${port}/examples/`))
