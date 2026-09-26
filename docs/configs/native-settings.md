# Native settings

A consuming repository puts each setting in the file its tool reads.

## Settings by file

| File | Setting | Reader |
| --- | --- | --- |
| `.github/workflows/*.yml` | Pull request commands, scheduled commands, target branch, runner labels | GitHub Actions and `checks-ci-wiring` |
| `.oxlintrc.json` | Effect paths, exemptions, file size, function size, statements, cognitive complexity and depth | oxlint, `checks-size-budget` and `checks-repetition` |
| `tsconfig.json` | Effect language service scope and severity | TypeScript and Effect language service |
| `package.json` | `scripts`, `author`, `contributors` and `vendorSources` | Bun, `checks-commit-identity` and `checks-vendor` |
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
| `defaultBranch`, `runsOn`, `gates.ci`, `gates.scheduled` | Branch triggers, `runs-on` and `run` steps in `.github/workflows/*.yml` |
| `gates.lint` | `checks-lint` runs every kit gate |
| `commitIdentity.authors` | `author` and `contributors` in `package.json` |
| `sources.production`, `size.production`, `size.tests` | File overrides and native size rules in `.oxlintrc.json` |
| `sources.effect.paths`, `sources.effect.exempt` | Overrides in `.oxlintrc.json` and `tsconfig.json` |
| `sources.libraries` | `vendorSources` in `package.json` |
| `docs.pages` | Page front matter outside the standard reference directories |
| `docs.forConsumers` | README and directory placement |
| `features`, `changeSignal`, `agentRules` | No active declarations used these fields |

The kit has no general configuration manifest or generated workflow.
`checks-ci-wiring` requires lint and title lint on opened and synchronized pull requests.
When the repository tracks TypeScript, it also requires build, typecheck, test and a clean git diff after the build.
`checks-size-budget` and `checks-repetition` use the production files in the oxlint size override.
A size override without production paths fails instead of silently measuring nothing.

## Related topics

- [The Effect rules](effect-rules.md)
- [The CI wiring check](../gates/checks-ci-wiring.md)
- [The size budget](../gates/checks-size-budget.md)
