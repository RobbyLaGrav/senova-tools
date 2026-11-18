# Changelog

All notable changes to this tool. Format: [Keep a Changelog](https://keepachangelog.com); versions: [Semantic Versioning](https://semver.org).

## Unreleased

### Added

- Headless engine (`createSim`): event camera with contrast threshold and optional noise, leaky integrate-and-fire neurons with configurable receptive fields, population-vector decoder, exact operation counts against a clocked processor. Deterministic for a given seed.
- Canvas renderer (`createRenderer`, `drawSensor`, `drawRaster`, `drawMembrane`) and an animation loop (`startLoop`) that stops off screen.
- `<SpikeSim />` React component at `@senova/spikesim/react`, themed through `--spikesim-*` CSS custom properties.
- Examples: a headless script and a browser page served without a build step.
