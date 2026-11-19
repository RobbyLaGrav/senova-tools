# Diskguard

Watch dev-machine disk space and clear build caches across all your git worktrees, as a dry run until you say `--yes`.

**For:** anyone running many branches side by side (git worktrees, agent sessions, review checkouts), where every copy grows its own `.next`, `dist` and `node_modules/.cache` until the disk is full. **Status:** in progress (0.x: the API may still change before 1.0).

- **Free space.** `diskguard status` reads free space with `fs.statfs` for one or more paths and grades it against `--warn` and `--critical` thresholds, in bytes (`20GB`) or percent (`10%`). `diskguard watch` keeps checking and prints a line only when a path crosses a threshold.
- **Every worktree.** `diskguard scan ~/code` finds repositories by looking for `.git` files and folders, then asks each one `git worktree list --porcelain`, so linked worktrees are found too, with their branch and last-commit time.
- **Only caches.** A folder is a candidate only if its name is on a fixed allowlist **and** git says it is ignored **and** it holds no tracked files. A `build/` folder that is source in your project is left alone.
- **Dry run by default.** `diskguard clean` shows what it would delete and how much it would free. Nothing is deleted without `--yes`. `--target 20GB` stops as soon as the volume has that much free.

## Install

```sh
npm install @senova/diskguard
```

Not on npm yet: until it is, clone this repository and run `npm install` at its root, then use `node packages/diskguard/src/bin.ts` where this page says `diskguard`. Node.js 24 or newer, and `git` on the PATH.

## Two-minute example

Check the disk, see what's there, then clear the biggest caches until 30 GB are free:

```sh
diskguard status --warn 15% --critical 5GB
# WARN     .  16.5 GB free of 509 GB (3.2%)

diskguard scan ~/code
# app  main  last commit 2026-10-19
#        300 kB  .next
#        120 kB  node_modules/.cache
# app-feature  feature  [linked]  last commit 2026-11-16
#       80.0 kB  dist
#       12.0 kB  build  (skip: not ignored by git, so it may be source, not a cache)
# 2 worktree(s), 4 cache folder(s), 500 kB clearable

diskguard clean ~/code --target 30GB --oldest-first          # dry run: prints the plan, deletes nothing
diskguard clean ~/code --target 30GB --oldest-first --yes    # does it
```

The same from code. [`examples/dry-run.ts`](examples/dry-run.ts) builds a throwaway repository with a linked worktree in the temp folder and runs this (`node packages/diskguard/examples/dry-run.ts`):

```ts
import { checkSpace, clean, formatBytes } from "@senova/diskguard"

const [disk] = await checkSpace(["/home/me/code"], { warn: "10%" })
console.log(`free: ${formatBytes(disk.free)} (${disk.level})`)

const plan = await clean(["/home/me/code"], { target: "30GB" }) // add yes: true to delete
for (const a of plan.actions) console.log(a.result, formatBytes(a.bytes), a.name, a.branch)
console.log(`would free ${formatBytes(plan.freedBytes)}`)
```

## What gets cleared, and what never does

Cache folder names (the allowlist): `.next`, `node_modules/.cache`, `.turbo`, `dist`, `build`, `out`, `target`, `.parcel-cache`, `coverage`, `__pycache__`, `.pytest_cache`. Whole `node_modules` folders only with `--node-modules`. They are looked for up to 6 levels inside each worktree, so monorepo folders like `apps/web/.next` count.

A candidate is **skipped**, with the reason printed, when:

| Reason | Why |
| --- | --- |
| it is a symlink or Windows junction | links are never followed, measured through, or cleared |
| git doesn't ignore it, or it holds tracked files | then it is part of the project, whatever its name |
| anything in it changed in the last 10 minutes (`--min-age`) | a dev server or build is probably writing to it |
| its worktree is locked (`git worktree lock`) | someone said to leave it |
| a git command is running in the worktree (`index.lock`) | deleting under git mid-command is asking for trouble |
| the worktree has `.next/dev/lock` (a running Next.js 16 dev server) or `.diskguard-keep` | create `.diskguard-keep` to opt a worktree out for good |
| its real location is outside the roots | checked with `realpath`, so a link in a parent folder can't lead outside |
| the free-space target is already reached | shown as "not needed" |

Roots are refused outright if they are the top of a filesystem (`/`, `C:\`), the home folder, or a folder containing it (`/home`, `C:\Users`). Linked worktrees outside the roots are ignored. Right before each deletion diskguard checks again that the folder is still a real folder inside a root, then deletes it with `lstat` at every step: a link met on the way is removed as a link, never followed.

## CLI

```
diskguard status [paths...]   [--warn <size|%>] [--critical <size|%>] [--json]
diskguard watch  [paths...]   [--warn <size|%>] [--critical <size|%>] [--interval 60s] [--json]
diskguard scan   <roots...>   [--node-modules] [--min-age 10m] [--depth 6] [--json]
diskguard clean  <roots...>   [--yes] [--target <size|%>] [--oldest-first] [--node-modules] [--min-age 10m] [--depth 6] [--json]
```

- Sizes: `500MB`, `20GB`, `1.5TB` (decimal: 1 GB = 1,000,000,000 bytes), `20GiB` (binary), or plain bytes. Percent: `10%` of the volume.
- Durations need a unit: `500ms`, `30s`, `10m`, `2h`, `1d`.
- `clean` orders biggest folder first; `--oldest-first` orders by the worktree's last commit, oldest first.
- `--target` is checked per root, on the volume that holds it. In a dry run free space is projected by adding up sizes; with `--yes` it is read again after each deletion.
- `watch --json` prints one JSON object per line; the others print one JSON document.
- Exit codes: `0` fine, `1` low space (`status`) or a deletion failed (`clean`), `2` bad input.

## API

Everything below is exported from `@senova/diskguard`. Bad input throws `DiskguardInputError` with a message naming the value.

### Free space

- `getFreeSpace(path): Promise<SpaceInfo>`: `{ path, free, total, freePercent }` for the volume holding `path` (`fs.statfs`; `free` is what the current user can write).
- `checkSpace(paths, thresholds?, read?): Promise<SpaceStatus[]>`: each reading plus `level`: `"ok" | "warn" | "critical"`. `thresholds` is `{ warn?, critical? }`, each a `Threshold` or a string (`"20GB"`, `"10%"`).
- `watchFreeSpace(paths, { warn?, critical?, interval?, onChange, onError?, signal?, read? }): Promise<void>`: polls (default every 60 s) and calls `onChange({ status, previous, at })` on the first reading and on every level change. Resolves when `signal` aborts.
- `levelOf(info, thresholds)`: the level of one reading.
- `read` is any `(path) => Promise<SpaceInfo>`, for tests or remote disks.

### Worktrees and caches

- `scan(roots, options?): Promise<ScanResult>`: `{ roots, worktrees, caches, clearableBytes, warnings }`. Reads only. Options: `includeNodeModules`, `minAge` (ms or `"10m"`), `depth`, `now`, `home`.
- `clean(roots, options?): Promise<CleanResult>`: scan options plus `yes`, `target`, `oldestFirst`, `read`, `onAction`. Returns `{ dryRun, actions, freedBytes, volumes, scan }`; each action is `{ path, name, worktree, branch, bytes, result, reason }` with `result` one of `deleted`, `would-delete`, `skipped`, `not-needed`, `failed`.
- `findWorktrees(realRoots, { depth?, warnings? }): Promise<Worktree[]>`: `{ path, root, branch, head, main, lastCommit, inUse, gitError }`.
- `findCaches(worktree, { includeNodeModules?, depth?, otherWorktrees? }): Promise<CacheFolder[]>` and `measureDir(path): Promise<DirSize>` (`bytes`, `sharedBytes`, `files`, `newestMs`, `links`; never follows links; hard-linked files counted once, as shared).
- `parseWorktreePorcelain(text, cwd)`: parses `git worktree list --porcelain`.
- `CACHE_NAMES`, `NODE_MODULES_CACHES`, `IN_USE_MARKERS`: the lists above.

### Safety and parsing

- `checkRoot(path, home?)`: the root's real path, or throws for filesystem tops, the home folder and its parents, and missing folders.
- `containingRoot(path, realRoots)`, `isInside(parent, child)`: containment after resolving links.
- `removeTree(path)`: deletes without following links.
- `parseSize`, `parseThreshold`, `parseDuration`, `thresholdBytes`, `formatBytes`, `formatThreshold`.

## Limits

- Sizes are file sizes (`st_size`), not blocks on disk, so compressed or sparse files can free less than shown. Files with more than one hard link (pnpm's store, for example) are reported as `sharedBytes` and not counted as freed, because deleting one link frees nothing while another remains.
- "In use" detection covers what leaves a trace on disk: git worktree locks, `index.lock`, Next.js 16's dev lock file, `.diskguard-keep`, and recent changes. A dev server that writes nothing for 10 minutes and leaves no lock file can't be seen; raise `--min-age` if that worries you.
- Caches are confirmed with `git check-ignore`, so folders in non-git projects are never cleared, and a broken or missing `git` means everything is skipped.
- Deleting is sequential and walks every file, which is slow for very large `node_modules` folders. A deletion interrupted half-way leaves a half-deleted cache, which the next build recreates.
- Tested on Windows (NTFS, symlinks and junctions) with Node 24. Linux and macOS use the same Node calls but were not part of the test runs for this version.

## Dependencies

None. Uses Node's `fs`, `child_process` and `util`, and the `git` you already have.

## Licence

[AGPL-3.0-or-later](../../LICENSE). Copyright © 2026 Senova Systems LLC and contributors.
