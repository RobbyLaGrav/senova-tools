# Changelog

All notable changes to this tool. Format: [Keep a Changelog](https://keepachangelog.com); versions: [Semantic Versioning](https://semver.org).

## Unreleased

- Typed results: `s` schema builders, `loadResults`, `parseResults` and `validateResults`, listing every problem by path.
- Computed wording: `compare` ("cut the error to … from …" or "did not beat …"), `describeChange`, `percentChange`, `times` and `formatNumber`, comparing numbers as printed.
- Rule-based headlines: `pickHeadline` and `within`.
- Claim checker: `hype`, `hardware-claim`, `simulation-note`, `price`, `vendor-figure` and `insecure-source` rules, custom pattern rules, ignore directives, JSON config, and the `honest` CLI with text, JSON and GitHub output and CI exit codes.
