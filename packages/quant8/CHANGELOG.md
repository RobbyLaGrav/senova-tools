# Changelog

All notable changes to this tool. Format: [Keep a Changelog](https://keepachangelog.com); versions: [Semantic Versioning](https://semver.org).

## Unreleased

- Post-training int8 quantisation of dense networks (relu / none, optional softmax): symmetric per-channel weights, asymmetric or symmetric per-tensor activations from calibration, int32 bias, fixed-point requantisation.
- TypeScript int8 reference interpreter, bit-exact with the generated C.
- C99 generator (one .h/.c pair, const weights, static scratch, no malloc, integer-only predict) with flash/RAM estimates.
- Float vs int8 accuracy report and the `quant8` CLI.
