// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// Every package has the same shape (docs/ARCHITECTURE.md): README.md, package.json with the AGPL licence field and
// an @senova/ name, src/index.ts, at least one test, and a reference in the root tsconfig.json.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")
const refs = new Set(JSON.parse(readFileSync(join(root, "tsconfig.json"), "utf8")).references.map((r) => r.path))
const problems = []
for (const name of readdirSync(join(root, "packages"))) {
  const dir = join(root, "packages", name)
  if (!statSync(dir).isDirectory()) continue
  const need = (cond, what) => cond || problems.push(`packages/${name}: ${what}`)
  need(existsSync(join(dir, "README.md")), "missing README.md")
  need(existsSync(join(dir, "src", "index.ts")), "missing src/index.ts")
  const tests = existsSync(join(dir, "test")) ? readdirSync(join(dir, "test")).filter((f) => f.endsWith(".test.ts")) : []
  need(tests.length > 0, "no tests in test/*.test.ts")
  need(refs.has(`packages/${name}`), "not listed in the root tsconfig.json references")
  if (existsSync(join(dir, "package.json"))) {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))
    need(pkg.license === "AGPL-3.0-or-later", `licence field is "${pkg.license}", expected "AGPL-3.0-or-later"`)
    need(name === "_template" || pkg.name === `@senova/${name}`, `name is "${pkg.name}", expected "@senova/${name}"`)
  } else problems.push(`packages/${name}: missing package.json`)
}
if (problems.length) {
  console.error(`Package shape problems:\n  ${problems.join("\n  ")}`)
  process.exit(1)
}
console.log("Package shape: all packages follow docs/ARCHITECTURE.md.")
