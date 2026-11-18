# Releasing

Tools are versioned independently with [Semantic Versioning](https://semver.org).

1. Move the tool's "Unreleased" changelog entries under a new version heading.
2. Bump `version` in `packages/<tool>/package.json`.
3. `npm test`, `npm run check`, `npm run build -w @senova/<tool>`.
4. Commit `chore(<tool>): release vX.Y.Z` and tag `<tool>@vX.Y.Z`.
5. Publishing to npm is done by a maintainer. It is not automatic.
