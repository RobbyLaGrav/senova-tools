# Changelog

All notable changes to this tool. Format: [Keep a Changelog](https://keepachangelog.com); versions: [Semantic Versioning](https://semver.org).

## Unreleased

### Added

- `getFreeSpace`, `checkSpace` and `watchFreeSpace`: free space via `fs.statfs`, graded against warn and critical thresholds in bytes or percent, polled with change-only reporting.
- `scan` and `findWorktrees`: git worktrees under the given roots, from a folder scan plus `git worktree list --porcelain`, with branch, last-commit time and in-use signs (worktree lock, `index.lock`, Next.js dev lock, `.diskguard-keep`).
- `clean`: clears allowlisted cache folders that git ignores and that hold no tracked files; dry run unless `yes`, skips recent folders, biggest or oldest-branch first, stops at a free-space target. Never follows symlinks or junctions, re-checks containment with `realpath` before each deletion, and refuses filesystem roots and the home folder.
- The `diskguard` command: `status`, `watch`, `scan`, `clean`, with `--json`.
