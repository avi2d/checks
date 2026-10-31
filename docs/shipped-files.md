---
kind: reference
audience: consumers
---
# The shipped files

The package ships these paths, and a repository reads or copies them from its install.

## Where things are

Every path is relative to the installed package, `node_modules/@avi2dg/checks/`.

<!-- generated shipped: bun run build writes it from package.json and scripts/doc-blocks.ts -->

| Path | What it holds |
| --- | --- |
| `CHANGELOG.md` | every release, and what it changed |
| `docs/` | the how-to guides, a reference page per bin and per shared config, and why the kit is shaped this way |
| `bunfig.toml` | the bunfig preset a repository copies |
| `.bun-version` | the fleet bun version the bun pin check reads |
| `commitlint.config.ts` | the shared commitlint config |
| `dependency-cruiser.config.js` | the kit's dependency-cruiser rules as a base a `.dependency-cruiser.cjs` extends by path, which the build writes |
| `knip-base.json` | the Knip `include` setting, for a configuration that spreads it |
| `src/` | every bin, which a package script calls by its `checks-` name, the modules the bins import, the Effect language service severities under `src/quality/presets/`, and the starter `browser-checks.json` under `src/quality/browser/` |
| `dist/` | the compiled oxlint plugins, the config builders `@avi2dg/checks/oxlint`, `@avi2dg/checks/knip`, `@avi2dg/checks/dependency-cruiser` and `@avi2dg/checks/stylelint` resolve to, and the doc templates, one template per kind of doc file |
| `oxlintrc.json` | the oxlint `base` as a config a `.oxlintrc.json` extends by path, which the build writes |
| `stryker.preset.js` | the Stryker mutation-testing preset, which refuses a full run outside CI |
| `tsconfig.effect.json` | the tsconfig fragment with the shared compiler options and the Effect language-service block |
| `ts-reset.d.ts` | the two ts-reset rules `tsconfig.effect.json` lists in `files` |

<!-- end generated shipped -->

## Related topics

- [Set up a repository](how-to/set-up-a-repository.md)
- [Upgrade the kit](how-to/upgrade-the-kit.md)
