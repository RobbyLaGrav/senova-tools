// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Senova Systems LLC and contributors
//
// scan() and clean() on real git repositories and worktrees built in os.tmpdir().
import assert from "node:assert/strict"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"

import { clean, findWorktrees, measureDir, parseWorktreePorcelain, scan, type SpaceReader } from "../src/index.ts"
import { age, commit, linkDir, makeRepo, put, sh, tempRoot } from "./fixture.ts"

const DAY = 86_400
const NOW_S = Math.floor(Date.now() / 1000)

/**
 * root/app        main worktree (branch main, last commit 30 days ago) with .next, node_modules/.cache, node_modules/pkg
 * root/app-feat   linked worktree (branch feat, last commit 2 days ago) with dist and a monorepo apps/web/.next
 * Everything is aged 60 minutes, so nothing counts as recently changed.
 */
function workspace(t: { dir: string }) {
  const root = join(t.dir, "code")
  const app = makeRepo(join(root, "app"), { commitTime: NOW_S - 30 * DAY })
  sh(app, "worktree", "add", "-q", "-b", "feat", join(root, "app-feat"))
  const feat = join(root, "app-feat")
  commit(feat, "feature work", NOW_S - 2 * DAY)
  put(join(app, ".next", "cache", "a.bin"), 5000)
  put(join(app, "node_modules", ".cache", "b.bin"), 3000)
  put(join(app, "node_modules", "pkg", "index.js"), 7000)
  put(join(feat, "dist", "out.js"), 2000)
  put(join(feat, "apps", "web", ".next", "c.bin"), 4000)
  for (const d of [app, feat]) age(d, 60)
  return { root, app, feat }
}

const ok = (rel: string, list: Array<{ name: string; skip: string | undefined }>) => list.find((c) => c.name === rel)

test("README example: a dry run lists the caches and deletes nothing", async () => {
  const t = tempRoot("readme")
  try {
    const { root, app, feat } = workspace(t)
    const r = await clean([root])
    assert.equal(r.dryRun, true)
    const would = r.actions.filter((a) => a.result === "would-delete").map((a) => a.name).sort()
    assert.deepEqual(would, [".next", "apps/web/.next", "dist", "node_modules/.cache"])
    assert.equal(r.freedBytes, 5000 + 3000 + 2000 + 4000)
    for (const p of [join(app, ".next"), join(app, "node_modules", ".cache"), join(feat, "dist"), join(feat, "apps", "web", ".next")]) {
      assert.ok(existsSync(p), `${p} still there after a dry run`)
    }
    // Biggest first by default.
    assert.deepEqual(r.actions.map((a) => a.bytes), [5000, 4000, 3000, 2000])
  } finally {
    t.done()
  }
})

test("scan finds the main and linked worktrees with branches and last-commit times", async () => {
  const t = tempRoot("scan")
  try {
    const { root, app, feat } = workspace(t)
    const r = await scan([root])
    assert.deepEqual(r.worktrees.map((w) => [w.path, w.branch, w.main]), [[app, "main", true], [feat, "feat", false]])
    assert.equal(r.worktrees[0]!.lastCommit, NOW_S - 30 * DAY)
    assert.equal(r.worktrees[1]!.lastCommit, NOW_S - 2 * DAY)
    assert.equal(r.clearableBytes, 14000)
  } finally {
    t.done()
  }
})

test("--yes deletes only allowlisted, git-ignored caches; source and other folders stay", async () => {
  const t = tempRoot("yes")
  try {
    const { root, app, feat } = workspace(t)
    put(join(app, "docs", "guide.md"), 100)
    put(join(app, "my-cache", "keep.bin"), 100) // not on the allowlist
    age(app, 60)
    const r = await clean([root], { yes: true })
    assert.equal(r.dryRun, false)
    assert.equal(r.actions.filter((a) => a.result === "deleted").length, 4)
    for (const gone of [join(app, ".next"), join(app, "node_modules", ".cache"), join(feat, "dist"), join(feat, "apps", "web", ".next")]) {
      assert.equal(existsSync(gone), false, `${gone} deleted`)
    }
    for (const kept of [join(app, "src", "index.ts"), join(app, "docs", "guide.md"), join(app, "my-cache", "keep.bin"), join(app, "node_modules", "pkg", "index.js"), join(app, ".gitignore"), join(feat, "src", "index.ts")]) {
      assert.ok(existsSync(kept), `${kept} kept`)
    }
  } finally {
    t.done()
  }
})

test("whole node_modules folders are offered only with includeNodeModules", async () => {
  const t = tempRoot("nm")
  try {
    const { root, app } = workspace(t)
    const without = await scan([root])
    assert.equal(ok("node_modules", without.caches), undefined)
    const withNm = await scan([root], { includeNodeModules: true })
    assert.equal(ok("node_modules", withNm.caches)?.skip, undefined)
    assert.equal(ok("node_modules/.cache", withNm.caches), undefined, "not listed twice")
    await clean([root], { yes: true, includeNodeModules: true })
    assert.equal(existsSync(join(app, "node_modules")), false)
  } finally {
    t.done()
  }
})

test("a cache folder git doesn't ignore, or one holding tracked files, is skipped", async () => {
  const t = tempRoot("gitcheck")
  try {
    const root = join(t.dir, "code")
    // Only .next is ignored here: build/ is source in this project, and dist/ has a tracked file.
    const repo = makeRepo(join(root, "lib"), { gitignore: ".next/\ndist/\n" })
    put(join(repo, "build", "script.js"), 300)
    put(join(repo, "dist", "vendored.js"), 300)
    sh(repo, "add", "-f", "dist/vendored.js")
    commit(repo, "vendor")
    put(join(repo, "dist", "generated.js"), 300)
    put(join(repo, ".next", "x.bin"), 300)
    age(repo, 60)
    const r = await clean([root], { yes: true })
    const by = (n: string) => r.actions.find((a) => a.name === n)
    assert.equal(by(".next")?.result, "deleted")
    assert.equal(by("build")?.result, "skipped")
    assert.match(by("build")!.reason!, /not ignored by git/)
    assert.equal(by("dist")?.result, "skipped")
    assert.match(by("dist")!.reason!, /tracked by git/)
    assert.ok(existsSync(join(repo, "build", "script.js")))
    assert.ok(existsSync(join(repo, "dist", "generated.js")))
  } finally {
    t.done()
  }
})

test("symlinks and junctions are never followed: not measured, not cleared through", async (ctx) => {
  const t = tempRoot("links")
  try {
    const root = join(t.dir, "code")
    const repo = makeRepo(join(root, "app"))
    const outside = join(t.dir, "precious")
    put(join(outside, "data.bin"), 9000)
    put(join(repo, ".next", "own.bin"), 1000)
    const inner = linkDir(outside, join(repo, ".next", "link-out"))
    if (inner === undefined) return ctx.skip("this OS does not allow creating a symlink or junction here")
    linkDir(outside, join(repo, "dist")) // the cache folder itself is a link
    age(repo, 60)

    const size = await measureDir(join(repo, ".next"))
    assert.equal(size.bytes, 1000, "the linked folder's 9000 bytes are not counted")
    assert.equal(size.links, 1)

    // minAge 0: the links were just created, and a link's own time counts as a change (tested separately).
    const r = await clean([root], { yes: true, minAge: 0 })
    const by = (n: string) => r.actions.find((a) => a.name === n)
    assert.equal(by(".next")?.result, "deleted")
    assert.equal(by("dist")?.result, "skipped")
    assert.match(by("dist")!.reason!, /symlink or junction/)
    assert.equal(existsSync(join(repo, ".next")), false)
    assert.equal(readFileSync(join(outside, "data.bin"), "utf8").length, 9000, `files behind the ${inner} survive`)
  } finally {
    t.done()
  }
})

test("a linked worktree outside the roots is not touched", async () => {
  const t = tempRoot("contain")
  try {
    const root = join(t.dir, "code")
    const app = makeRepo(join(root, "app"))
    const away = join(t.dir, "elsewhere", "app-away")
    sh(app, "worktree", "add", "-q", "-b", "away", away)
    put(join(away, ".next", "x.bin"), 500)
    age(join(t.dir, "elsewhere"), 60)
    const r = await clean([root], { yes: true })
    assert.deepEqual(r.scan.worktrees.map((w) => w.path), [app])
    assert.ok(existsSync(join(away, ".next", "x.bin")))
  } finally {
    t.done()
  }
})

test("roots that are a filesystem top, the home folder, or missing are refused before anything runs", async () => {
  const t = tempRoot("roots")
  try {
    const home = join(t.dir, "home")
    mkdirSync(join(home, "code"), { recursive: true })
    await assert.rejects(clean([home], { yes: true, home }), /home folder/)
    await assert.rejects(clean([t.dir], { yes: true, home }), /contains the home folder/)
    await assert.rejects(clean([join(t.dir, "nope")], { yes: true, home }), /not an existing folder/)
    await assert.rejects(clean([], { yes: true }), /at least one root/)
    await assert.rejects(scan([join(home, "code")], { depth: -1, home }), /depth/)
    await assert.rejects(scan([join(home, "code")], { minAge: "ten", home }), /duration/)
  } finally {
    t.done()
  }
})

test("folders changed in the last 10 minutes are skipped (and minAge changes that)", async () => {
  const t = tempRoot("recent")
  try {
    const { root, app } = workspace(t)
    writeFileSync(join(app, ".next", "cache", "fresh.bin"), "new") // a dev server just wrote here
    const r = await clean([root], { yes: true })
    const next = r.actions.find((a) => a.path === join(app, ".next"))!
    assert.equal(next.result, "skipped")
    assert.match(next.reason!, /changed 0 min ago/)
    assert.ok(existsSync(join(app, ".next", "cache", "a.bin")))
    const r2 = await clean([root], { yes: true, minAge: 0 })
    assert.equal(r2.actions.find((a) => a.path === join(app, ".next"))!.result, "deleted")
  } finally {
    t.done()
  }
})

test("worktrees that are locked, mid-git-command or marked keep are skipped", async () => {
  const t = tempRoot("inuse")
  try {
    const { root, app, feat } = workspace(t)
    sh(app, "worktree", "lock", "--reason", "long build", feat)
    writeFileSync(join(app, ".diskguard-keep"), "")
    const r = await clean([root], { yes: true })
    for (const a of r.actions) assert.equal(a.result, "skipped", a.name)
    assert.ok(r.actions.some((a) => /git worktree lock: long build/.test(a.reason!)))
    assert.ok(r.actions.some((a) => /\.diskguard-keep/.test(a.reason!)))
    sh(app, "worktree", "unlock", feat)
    const gitDir = sh(feat, "rev-parse", "--absolute-git-dir").trim()
    writeFileSync(join(gitDir, "index.lock"), "")
    const wts = await findWorktrees([root])
    assert.match(wts.find((w) => w.path === feat)!.inUse.join(), /index\.lock/)
  } finally {
    t.done()
  }
})

test("a free-space target stops clearing once reached, in dry runs and real runs", async () => {
  const t = tempRoot("target")
  try {
    const { root, app } = workspace(t)
    // A fake volume: 10,000 bytes free plus whatever has been deleted from the workspace.
    const caches = [join(app, ".next"), join(app, "node_modules", ".cache")]
    const read: SpaceReader = async (p) => {
      const freed = (existsSync(caches[0]!) ? 0 : 5000) + (existsSync(caches[1]!) ? 0 : 3000)
      return { path: p, free: 10_000 + freed, total: 100_000, freePercent: 0 }
    }
    const dry = await clean([root], { target: "14000", read })
    assert.deepEqual(dry.actions.map((a) => a.result), ["would-delete", "not-needed", "not-needed", "not-needed"])
    assert.equal(dry.volumes[0]!.targetReached, true)
    assert.equal(dry.volumes[0]!.freeAfter, 15_000)

    const real = await clean([root], { yes: true, target: { percent: 14 }, read })
    assert.deepEqual(real.actions.map((a) => a.result), ["deleted", "not-needed", "not-needed", "not-needed"])
    assert.equal(existsSync(caches[0]!), false)
    assert.ok(existsSync(caches[1]!))

    const already = await clean([root], { target: "1KB", read })
    assert.ok(already.actions.every((a) => a.result === "not-needed"))
    await assert.rejects(clean([root], { target: "lots", read }), /can't read size/)
  } finally {
    t.done()
  }
})

test("oldestFirst clears the branch with the oldest last commit first", async () => {
  const t = tempRoot("oldest")
  try {
    const { root, app, feat } = workspace(t)
    const r = await clean([root], { oldestFirst: true })
    assert.deepEqual(r.actions.map((a) => a.worktree), [app, app, feat, feat])
    assert.deepEqual(r.actions.map((a) => a.branch), ["main", "main", "feat", "feat"])
  } finally {
    t.done()
  }
})

test("a folder that isn't a git repository is reported with no caches", async () => {
  const t = tempRoot("plain")
  try {
    put(join(t.dir, "code", "notes", ".next", "x.bin"), 10)
    const r = await scan([join(t.dir, "code")])
    assert.deepEqual(r.worktrees, [])
    assert.deepEqual(r.caches, [])
  } finally {
    t.done()
  }
})

test("parseWorktreePorcelain reads branches, detached heads, bare repos and locks", () => {
  const text = [
    "worktree /r/main", "HEAD aaa", "branch refs/heads/main", "",
    "worktree /r/wt1", "HEAD bbb", "detached", "locked", "",
    "worktree /r/wt2", "HEAD ccc", "branch refs/heads/feature/x", "locked moving disks", "prunable gitdir file points to non-existent location", "",
    "worktree /r/bare.git", "bare", "",
  ].join("\n")
  const e = parseWorktreePorcelain(text, "/r")
  assert.equal(e.length, 4)
  assert.equal(e[0]!.main, true)
  assert.equal(e[0]!.branch, "main")
  assert.equal(e[1]!.branch, undefined)
  assert.equal(e[1]!.locked, "")
  assert.equal(e[2]!.branch, "feature/x")
  assert.equal(e[2]!.locked, "moving disks")
  assert.equal(e[3]!.bare, true)
})
