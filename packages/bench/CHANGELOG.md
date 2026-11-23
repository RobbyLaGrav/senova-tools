# Changelog

All notable changes to this tool. Format: [Keep a Changelog](https://keepachangelog.com); versions: [Semantic Versioning](https://semver.org).

## Unreleased

- Board interface with `CommandBoard` (your own flash and reset programs, run without a shell, plus a TCP serial console) and a seeded `SimBoard`.
- Test runner: flash once, reset between tests, per-test timeouts, `waitFor` on console lines, measurements with limits.
- Per-board lock file with stale-lock takeover.
- Results file with validation, JUnit XML, and a Markdown pull-request report with base-branch comparison and Mermaid trend charts.
- `bench run` and `bench report` commands.
