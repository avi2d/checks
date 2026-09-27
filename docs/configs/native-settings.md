---
kind: reference
audience: consumers
---
# Native settings

A consuming repository puts each setting in the file its tool reads, and no manifest of the kit gathers them.

## Settings by file

| File | Setting | Reader |
| --- | --- | --- |
| `.github/workflows/*.yml` | Pull request commands, scheduled commands, runner labels | GitHub Actions and `checks-ci-wiring` |
| `.oxlintrc.json` | Effect paths, exemptions, file size, function size, statements, cognitive complexity and depth | oxlint |
| `oxlint-suppressions.json` | The existing violations oxlint suppresses, per file and rule | oxlint and `checks-suppressions-ratchet` |
| `exports-baseline.json` | The existing unused exports and types, per file, kind and name | `checks-exports` |
| `.jscpd.json` | The `path` and `ignore` globs of the files repetition is measured in | jscpd and `checks-repetition` |
| `knip.config.ts` | The `entry` globs Knip traces unreferenced files from, spread over the kit's `knip-base.json` | Knip, `checks-unused` and `checks-exports` |
| `tsconfig.json` | Effect language service scope and severity | TypeScript and Effect language service |
| `package.json` | `scripts` with the `checks-vendor` arguments in `prepare`, `author` and `contributors` | Bun, `checks-commit-identity` and `checks-vendor` |
| `bunfig.toml` | Test discovery and quarantine exclusion | Bun and `checks-test-layout` |
| `.dependency-cruiser.cjs` | Import rules | dependency-cruiser |
| `stryker.conf.mjs` | Mutation settings | Stryker |
| Each page under `docs/` | Diátaxis mode in `kind` front matter, and `audience: consumers` on a page that speaks to a consuming repository | `checks-docs` |

Every page under `docs/` names its mode in `kind` front matter, whatever directory holds it.
A page whose front matter sets `audience: consumers` names commands that a consuming repository runs.
`checks-docs` skips the `bun run` commands on such a page, and looks up those in every other living doc in its nearest `package.json`.

## Size limits

The size rules are oxlint's own rules at `error` in `.oxlintrc.json`, so `bun run lint` fails on any file over them.
A repository records its existing violations with `oxlint --suppress-all`, which writes them to `oxlint-suppressions.json`.
`checks-suppressions-ratchet` refuses any count in that file that rises.
The kit's own `.oxlintrc.json` sets these limits for each size override, and a repository may copy them:

<!-- generated size-limits: bun run build writes it from .oxlintrc.json, SIZE_RULES in src/complexity/size-rules.ts and scripts/doc-blocks.ts -->

| Limits | oxlint rule | `src/**/*.ts`, `scripts/**/*.ts` | `tests/**/*.ts` |
| --- | --- | --- | --- |
| The most lines a file may hold, blank and comment lines counted | `max-lines` | 400 | 600 |
| The most lines a function may span, blank and comment lines counted | `max-lines-per-function` | 100 | off |
| The most statements a function may hold | `max-statements` | 30 | 50 |
| The highest cognitive complexity a function may reach, a switch counted once | `readability/cognitive-complexity` | 15 | 15 |
| The deepest a block may nest inside a function | `max-depth` | 4 | 4 |

<!-- end generated size-limits -->

## Related topics

- [The Effect rules](effect-rules.md)
- [checks-ci-wiring](../gates/checks-ci-wiring.md)
- [checks-suppressions-ratchet](../gates/checks-suppressions-ratchet.md)
- [checks-docs](../gates/checks-docs.md)
