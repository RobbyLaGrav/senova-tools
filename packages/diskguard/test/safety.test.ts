// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { join, parse } from "node:path"
import { after, test } from "node:test"

import { checkRoot, containingRoot, DiskguardInputError, isInside } from "../src/index.ts"
import { linkDir, tempRoot } from "./fixture.ts"

const t = tempRoot("safety")
after(t.done)

test("isInside is strict and not fooled by name prefixes", () => {
  const a = join(t.dir, "a")
  assert.equal(isInside(a, join(a, "b")), true)
  assert.equal(isInside(a, a), false)
  assert.equal(isInside(a, join(t.dir, "ab")), false)
  assert.equal(isInside(a, join(a, "..", "c")), false)
  assert.equal(isInside(a, t.dir), false)
})

test("checkRoot refuses filesystem roots, the home folder and its parents", () => {
  const home = join(t.dir, "people", "me")
  mkdirSync(home, { recursive: true })
  assert.throws(() => checkRoot(parse(t.dir).root, home), /top of a filesystem/)
  assert.throws(() => checkRoot(home, home), /home folder/)
  assert.throws(() => checkRoot(join(t.dir, "people"), home), /contains the home folder/)
  assert.throws(() => checkRoot(t.dir, home), /contains the home folder/)
  const code = join(home, "code")
  mkdirSync(code)
  assert.equal(checkRoot(code, home), code)
})

test("checkRoot refuses missing folders, files and empty input", () => {
  const home = join(t.dir, "elsewhere-home")
  assert.throws(() => checkRoot(join(t.dir, "missing"), home), /not an existing folder/)
  writeFileSync(join(t.dir, "file.txt"), "x")
  assert.throws(() => checkRoot(join(t.dir, "file.txt"), home), /not an existing folder/)
  assert.throws(() => checkRoot("", home), DiskguardInputError)
})

test("containingRoot follows links to their real place, so a link out of the root is outside", (ctx) => {
  const root = join(t.dir, "root")
  const outside = join(t.dir, "outside")
  mkdirSync(join(root, "real"), { recursive: true })
  mkdirSync(outside, { recursive: true })
  if (linkDir(outside, join(root, "link")) === undefined) return ctx.skip("this OS does not allow creating a symlink or junction here")
  assert.equal(containingRoot(join(root, "real"), [root]), root)
  assert.equal(containingRoot(join(root, "link"), [root]), undefined)
  assert.equal(containingRoot(join(root, "missing"), [root]), undefined)
  assert.equal(containingRoot(root, [root]), undefined, "the root itself is not inside")
})
