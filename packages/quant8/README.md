# Quant8

Quantise a small feed-forward network to 8-bit integers and generate dependency-free C99 that runs it on a microcontroller, with the same output bits as a TypeScript reference.

**For:** embedded and TinyML developers who trained a small dense network (a gesture, sensor or keyword classifier) and need it on a part with no FPU and a few KB of flash, without pulling in a runtime. **Status:** in progress (0.x: the API may still change before 1.0).

- **Post-training int8.** Weights are symmetric per output channel; activations are per tensor, asymmetric (default) or symmetric, with ranges taken from your calibration samples; biases are int32. Rescaling uses fixed-point multipliers (an int32 Q31 fraction plus a shift, the gemmlowp / TensorFlow Lite convention) with rounding and saturation everywhere.
- **Bit-exact reference.** `runInt8` in TypeScript computes the same int8 outputs as the generated C, byte for byte. The test suite compiles the C with gcc or clang (when one is installed) and compares every output.
- **Plain C99.** One `.h` and one `.c`: `const` weight arrays (flash), at most two static scratch buffers (RAM), no `malloc`, no floating point in `<name>_predict`. Float helpers for quantising inputs and dequantising outputs sit behind a switch you can turn off.
- **Measured, not promised.** A report of float vs int8 over your test set (max and mean absolute error, argmax agreement, label accuracy if you give labels) and flash/RAM byte estimates.

## Install

```sh
npm install @senova/quant8
```

Not on npm yet: until it is, clone this repository and run `npm install` at its root. Node.js 24 or newer. Inside the repository the `quant8` command is `node packages/quant8/src/bin.ts`.

## Two-minute example

[`examples/gesture/`](examples/gesture) holds a 4 -> 16 relu -> 8 relu -> 3 softmax classifier for three kinds of 4-value sensor reading, with 60 calibration and 150 labelled test samples (made by [`examples/make-example.ts`](examples/make-example.ts), which trains it with a fixed seed). From `packages/quant8`:

```sh
quant8 examples/gesture/model.json --calib examples/gesture/calib.json --test examples/gesture/test.json --out out --name gesture
# or: node examples/run-example.ts
```

```text
4 -> 16 -> 8 -> 3 (softmax), asymmetric activations
flash 459 bytes (const data), RAM 32 bytes (scratch) + 7 bytes (your input and output)
float vs int8 over 150 test samples: max abs error 0.0130, mean 0.0000911, argmax agreement 100.0% (150/150)
label accuracy: float 100.0%, int8 100.0%
wrote out/gesture.h, out/gesture.c, out/gesture.report.json
```

On the device:

```c
#include "gesture.h"

int classify(const float reading[GESTURE_INPUT_SIZE])
{
    int8_t in[GESTURE_INPUT_SIZE], out[GESTURE_OUTPUT_SIZE];
    gesture_quantize_input(reading, in);   /* or quantise in your own fixed-point sensor code */
    gesture_predict(in, out);              /* integers only */
    return gesture_argmax(out);            /* softmax does not change the winner */
}
```

Compile with any C99 compiler (add `-lm` if you keep the float helpers). Define `GESTURE_NO_FLOAT` to drop them, and with them every `float`, `double` and `<math.h>`.

The same from TypeScript:

```ts
import { readFileSync } from "node:fs"
import { quant8, quantizeInput, runInt8 } from "@senova/quant8"

const read = (f: string) => JSON.parse(readFileSync(f, "utf8"))
const r = quant8(read("model.json"), read("calib.json"), { name: "gesture", test: read("test.json") })
console.log(r.memory.flashBytes, r.accuracy.argmaxAgreement) // 459 1
const out = runInt8(r.quantized, quantizeInput(r.quantized, [1.2, -0.4, 0.3, 2.0])) // what gesture_predict returns
```

### File formats

Model (`weights[o][i]`: one row per output, one column per input; `bias` defaults to zeros, `activation` to `"none"`, `inputSize` to the first layer's column count):

```json
{
  "inputSize": 2,
  "softmax": true,
  "layers": [
    { "weights": [[1, -1], [0.5, 0.25], [-0.75, 1]], "bias": [0.1, 0, -0.2], "activation": "relu" },
    { "weights": [[1, 0.5, -1], [-0.5, 1, 0.25]], "bias": [0, 0.05], "activation": "none" }
  ]
}
```

Samples (calibration or test): `[[0.1, 0.2], ...]` or `{ "inputs": [[0.1, 0.2], ...], "labels": [1, ...] }`. Use calibration samples that cover the range the device will see: inputs and activations outside the calibrated range saturate.

## The integer scheme

For each layer and output channel `o`:

```text
acc  = bias[o] + sum_i w[o][i] * (x[i] - x_zp)                  int32 (bounds checked at quantisation time)
y[o] = clamp(round(acc * M[o]) + y_zp, act_min, 127)            M[o] = x_scale * w_scale[o] / y_scale
```

`M[o]` is stored as `multiplier[o]` (int32 in [2^30, 2^31)) and `shift[o]`; `round(acc * M)` is a saturating rounding doubling high multiply followed by a rounding divide by a power of two. `act_min` is the output zero point after relu (real 0), else -128. The C never right-shifts a negative number, which C99 leaves to the compiler.

## API

All exports are in `src/index.ts`.

- `quant8(modelJson, calibJson, { name?, scheme?, test? }): Quant8Result`: the whole pipeline; returns `model`, `quantized`, `c`, `memory` and `accuracy`.
- `parseModel(json): FloatModel` and `parseSamples(json, inputSize): Samples`: validate input; throw `Quant8Error` naming the exact path (`model.layers[1].weights[0] has 2 values, expected 3`).
- `quantize(model, calibrationInputs, { scheme? }): QuantModel`: post-training quantisation. Throws `Quant8Error` if a bias does not fit the int32 accumulator or a multiplier is out of range.
- `runInt8(qmodel, int8Input): Int8Array`: the reference interpreter, bit-exact with `<name>_predict`.
- `quantizeInput`, `dequantizeOutput` (applies softmax if the model has it), `predictQuantized` (float in, float out through the int8 network), `runFloat`, `forwardLayers`.
- `generateC(qmodel, { name? }): { headerName, sourceName, header, source }` and `memoryEstimate(qmodel): { flashBytes, ramBytes, ioBytes, layers }`.
- `accuracyReport(model, qmodel, samples): { samples, maxAbsError, meanAbsError, argmaxMatches, argmaxAgreement, floatAccuracy?, int8Accuracy? }`.
- Fixed-point building blocks: `quantizeMultiplier`, `saturatingRoundingDoublingHighMul`, `roundingDivideByPOT`, `multiplyByQuantizedMultiplier`, `requantize`, `chooseQParams`, `quantizeValue`, `dequantizeValue`, `roundHalfAway`.

CLI: `quant8 <model.json> --calib <file> --out <dir> [--test <file>] [--name <id>] [--symmetric] [--json]`. Writes `<name>.h`, `<name>.c` and `<name>.report.json`. Exit codes: 0 done, 1 bad input (message on stderr), 2 usage.

## Limits

- Dense layers with relu or no activation, and an optional softmax at the end. No convolutions, pooling, recurrent layers, other activations or batch norm (fold batch norm into the weights before export).
- Softmax is not done in integers: `<name>_predict` returns int8 logits and `<name>_dequantize_output` applies softmax in float. The argmax is the same either way.
- The flash figure counts const data only; the code adds more, depending on compiler and flags. The RAM figure counts the static scratch buffers; your input and output arrays and a small stack frame are extra.
- `<name>_predict` uses static scratch buffers, so it is not reentrant: do not call it from two threads, or from an interrupt while it is running.
- `<name>_quantize_input` (C, float) matches `quantizeInput` (TypeScript, double) when the input values are exactly representable as 32-bit floats; otherwise a value on a rounding boundary can differ by one step.
- Quantisation error depends on your calibration set. The report measures it on the samples you give; it is not a guarantee for other inputs.
- Up to 65,536 units per layer and 4,000,000 weights in total.
- Bit-exactness of the C is tested with gcc (and clang when installed) on the machine running the tests, not on every microcontroller toolchain. The C relies only on integer behaviour that C99 defines.

## Dependencies

None. The generated C needs only `<stdint.h>` (and `<math.h>` for the optional float helpers). The compile test uses a C compiler if one is installed (`$QUANT8_CC`, else `gcc`, `clang` or `cc` on PATH) and is skipped with a message otherwise.

## Licence

[AGPL-3.0-or-later](../../LICENSE). Copyright © 2026 Senova Systems LLC and contributors.
