// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Every source file (.ts, .tsx, .mjs, .js under packages/ and scripts/, outside dist and node_modules) must start
// with the SPDX licence header. Exits 1 and lists the files that don't.
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")
const SKIP = new Set(["node_modules", "dist", ".git"])
const missing = []
const walk = (dir) => {
  for (const f of readdirSync(dir)) {
    if (SKIP.has(f)) continue
    const p = join(dir, f)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.(ts|tsx|mjs|js)$/.test(f) && !f.endsWith(".d.ts")) {
      const head = readFileSync(p, "utf8").split("\n", 3).join("\n")
      if (!head.includes("SPDX-License-Identifier: AGPL-3.0-or-later")) missing.push(relative(root, p))
    }
  }
}
for (const d of ["packages", "scripts"]) walk(join(root, d))
if (missing.length) {
  console.error(`Missing the SPDX header (see CONTRIBUTING.md):\n  ${missing.join("\n  ")}`)
  process.exit(1)
}
console.log("Licence headers: all present.")
