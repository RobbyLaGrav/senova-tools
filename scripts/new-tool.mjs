// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// npm run new-tool -- <name>
// Copies packages/_template to packages/<name>, fills in the name, and adds it to the root tsconfig references.
import { cpSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const name = process.argv[2]
if (!name || !/^[a-z][a-z0-9-]{1,30}$/.test(name)) {
  console.error("Usage: npm run new-tool -- <name>   (lower case, letters, digits and dashes)")
  process.exit(1)
}
const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")
const dest = join(root, "packages", name)
if (existsSync(dest)) {
  console.error(`packages/${name} already exists`)
  process.exit(1)
}
cpSync(join(root, "packages", "_template"), dest, { recursive: true })

const title = name.charAt(0).toUpperCase() + name.slice(1)
const fill = (dir) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) fill(p)
    else writeFileSync(p, readFileSync(p, "utf8").replaceAll("__name__", name).replaceAll("__Name__", title))
  }
}
fill(dest)

const tsconfig = join(root, "tsconfig.json")
const cfg = JSON.parse(readFileSync(tsconfig, "utf8"))
cfg.references = [...cfg.references.filter((r) => r.path !== `packages/${name}`), { path: `packages/${name}` }].sort((a, b) => a.path.localeCompare(b.path))
writeFileSync(tsconfig, JSON.stringify(cfg, null, 2) + "\n")

console.log(`Created packages/${name}. Next: write its README, then src/index.ts and tests (docs/ADDING-A-TOOL.md).`)
