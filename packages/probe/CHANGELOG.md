# Changelog

All notable changes to this tool. Format: [Keep a Changelog](https://keepachangelog.com); versions: [Semantic Versioning](https://semver.org).

## Unreleased

- SCPI-over-TCP client: newline framing, one command in flight, per-command timeouts, reconnect with backoff, `SYST:ERR?` reads.
- Generic, DMM and power-supply drivers behind a command allow list and configured voltage/current limits.
- Typed measurements with SI unit checks; polling scheduler with skip/coalesce backpressure.
- Server-Sent Events server with a viewer page and `/latest`, JSONL recorder, and a noisy SCPI simulator.
