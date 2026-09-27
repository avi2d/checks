---
kind: reference
audience: consumers
---
# Native settings

A consuming repository puts each setting in the file its tool reads.

## Settings by file

| File | Setting | Reader |
| --- | --- | --- |
| `.github/workflows/*.yml` | Pull request commands, scheduled commands, runner labels | GitHub Actions and `checks-ci-wiring` |
| `.oxlintrc.json` | Effect paths, exemptions, file size, function size, statements, cognitive complexity and depth | oxlint |
| `oxlint-suppressions.json` | The existing violations oxlint suppresses, per file and rule | oxlint and `checks-suppressions-ratchet` |
| `.jscpd.json` | The `path` and `ignore` globs of the files repetition is measured in | jscpd and `checks-repetition` |
| `tsconfig.json` | Effect language service scope and severity | TypeScript and Effect language service |
| `package.json` | `scripts` with the `checks-vendor` arguments in `prepare`, `author` and `contributors` | Bun, `checks-commit-identity` and `checks-vendor` |
| `bunfig.toml` | Test discovery and quarantine exclusion | Bun and `checks-test-layout` |
| `.dependency-cruiser.cjs` | Import rules | dependency-cruiser |
| `stryker.conf.mjs` | Mutation settings | Stryker |
| Each page under `docs/` | Diátaxis mode in `kind` front matter, and `audience: consumers` on a page that speaks to a consuming repository | `checks-docs` |

Every page under `docs/` names its mode in `kind` front matter, whatever directory holds it.
A page whose front matter sets `audience: consumers` names commands a consuming repository runs, so `checks-docs` does not hold them to this `package.json`.
Every other living doc names commands this repository runs, and `checks-docs` holds each one to its `package.json`.

## Consumer migration

The following table maps the former fields to their owners.

| Former field | New owner |
| --- | --- |
| `defaultBranch` | Git's `refs/remotes/origin/HEAD`, or the pull request base or event repository in CI |
| `runsOn`, `gates.ci`, `gates.scheduled` | `runs-on` and `run` steps in `.github/workflows/*.yml` |
| `gates.lint` | `checks-lint` runs every kit gate |
| `commitIdentity.authors` | `author` and `contributors` in `package.json` |
| `sources.production` | `path` and `ignore` in `.jscpd.json` |
| `size.production`, `size.tests` | File overrides and native size rules in `.oxlintrc.json` |
| `sources.effect.paths`, `sources.effect.exempt` | Overrides in `.oxlintrc.json` and `tsconfig.json` |
| `sources.libraries` | `checks-vendor` arguments in the `prepare` script of `package.json` |
| `docs.pages` | `kind` front matter on each page |
| `docs.forConsumers` | `audience: consumers` front matter on each page |
| `features`, `changeSignal`, `agentRules` | No active declarations used these fields |

The kit has no general configuration manifest or generated workflow.
`checks-ci-wiring` requires title lint on opened and synchronized pull requests.
It also requires lint, build, typecheck and test for each of those scripts that `package.json` defines, and a clean git diff after a build.
`checks-repetition` runs jscpd with the repository's own `.jscpd.json`, so its `path` and `ignore` globs decide which files are measured.

## Size limits

The size rules are plain oxlint rules at `error` in `.oxlintrc.json`, and `bun run lint` enforces them on the whole tree.
A repository records its existing violations with `oxlint --suppress-all`, which writes them to `oxlint-suppressions.json`.
`checks-suppressions-ratchet` refuses any count in that file that rises, so the recorded debt only falls.
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
- [The CI wiring check](../gates/checks-ci-wiring.md)
- [The suppressions ratchet](../gates/checks-suppressions-ratchet.md)
