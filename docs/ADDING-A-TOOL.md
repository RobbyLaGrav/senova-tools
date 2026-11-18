# Adding a tool

1. `npm run new-tool -- <name>`: copies `packages/_template` to `packages/<name>` and fills in the name.
2. Write the README first, using the template's sections: what it does (one sentence), who it's for, install, a two-minute example, API, limits, dependencies.
3. Put the public API in `src/index.ts`. Keep internals in their own files, one concern each.
4. Write tests in `test/`. Cover the example from the README, edge cases and failure modes.
5. Add an `examples/` script that runs the README example.
6. Add the tool to the table in the root [README.md](../README.md).
7. `npm test` and `npm run check` must pass. Open a pull request.

## Naming

Short, plain, one word where possible (`Seedrun`, `Overflow`). Package name `@senova/<name>`, folder `packages/<name>`.
