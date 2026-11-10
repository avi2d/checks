# Decision records

<!-- generated adr-index: checks-adr-index writes it from the records in docs/adr/ -->

| Number | Title | Status | Governs |
| --- | --- | --- | --- |
| [0001](0001-cognitive-complexity.md) | The size budget holds cognitive complexity at 15 | Accepted | `src/complexity/readability/cognitive.ts`, `src/complexity/readability/cognitive-complexity.ts`, `src/complexity/readability/cognitive-nodes.ts`, `src/complexity/readability/cognitive-plain.ts`, `src/quality/presets/oxlint.ts` |
| [0002](0002-docs-front-door-and-no-pinned-versions.md) | The docs keep a short README, sort every other page by kind and copy no pinned version | Accepted | `README.md`, `docs`, `dist/templates`, `src/docs/doc-versions.ts` |
| [0003](0003-the-kit-fails-a-repository-whose-bun-pin-drifts-from-the-fleet-version.md) | The kit fails a repository whose Bun pin drifts from the fleet version | Accepted | `src/delivery/bun-pin.ts`, `.bun-version` |
| [0004](0004-the-css-families-ship-on-and-the-design-tokens-stay-opt-in.md) | The CSS families ship on, and the design tokens stay opt-in | Accepted | `src/quality/presets/stylelint.ts`, `src/quality/frontend-syntax.ts` |
| [0005](0005-the-kit-releases-on-demand-through-a-release-pull-request.md) | The kit releases on demand through a release pull request | Accepted | `.github/workflows/release.yml` |

<!-- end generated adr-index -->
