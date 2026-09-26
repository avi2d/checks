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
| `.oxlintrc.json` | Effect paths, exemptions, file size, function size, statements, cognitive complexity and depth | oxlint, `checks-size-budget` and `checks-repetition` |
| `tsconfig.json` | Effect language service scope and severity | TypeScript and Effect language service |
| `package.json` | `scripts` with the `checks-vendor` arguments in `prepare`, `author` and `contributors` | Bun, `checks-commit-identity` and `checks-vendor` |
| `bunfig.toml` | Test discovery and quarantine exclusion | Bun and `checks-test-layout` |
| `.dependency-cruiser.cjs` | Import rules | dependency-cruiser |
| `stryker.conf.mjs` | Mutation settings | Stryker |
| Each page under `docs/` | Diátaxis mode in `kind` front matter outside the standard gate and config directories | `checks-docs` |

`docs/gates/` and `docs/configs/` hold reference pages without front matter.
`docs/design.md` is an explanation page.
`README.md` and the gate and config pages address a consuming repository.
`CONTRIBUTING.md` and `docs/design.md` address this repository.

## Consumer migration

The following table maps the former fields to their owners.

| Former field | New owner |
| --- | --- |
| `defaultBranch` | Git's `refs/remotes/origin/HEAD`, or the pull request base or event repository in CI |
| `runsOn`, `gates.ci`, `gates.scheduled` | `runs-on` and `run` steps in `.github/workflows/*.yml` |
| `gates.lint` | `checks-lint` runs every kit gate |
| `commitIdentity.authors` | `author` and `contributors` in `package.json` |
| `sources.production`, `size.production`, `size.tests` | File overrides and native size rules in `.oxlintrc.json` |
| `sources.effect.paths`, `sources.effect.exempt` | Overrides in `.oxlintrc.json` and `tsconfig.json` |
| `sources.libraries` | `checks-vendor` arguments in the `prepare` script of `package.json` |
| `docs.pages` | Page front matter outside the standard reference directories |
| `docs.forConsumers` | README and directory placement |
| `features`, `changeSignal`, `agentRules` | No active declarations used these fields |

The kit has no general configuration manifest or generated workflow.
`checks-ci-wiring` requires title lint on opened and synchronized pull requests.
It also requires lint, build, typecheck and test for each of those scripts that `package.json` defines, and a clean git diff after a build.
`checks-size-budget` holds each file to the size overrides that match it, and `checks-repetition` measures the files of the production ones.
Size rules without a production override fail instead of silently measuring nothing.

## Related topics

- [The Effect rules](effect-rules.md)
- [The CI wiring check](../gates/checks-ci-wiring.md)
- [The size budget](../gates/checks-size-budget.md)
