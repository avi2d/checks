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
| `.oxlintrc.json` | Effect paths, exemptions, file size, function size, statements, cognitive complexity and depth | oxlint and `checks-size-budget` |
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
`checks-size-budget` runs oxlint with the repository's own `.oxlintrc.json`, so oxlint alone decides which files each size rule covers and at what limit.
A size rule at `error` is a hard limit that `bun run lint` enforces, and a rule at `warn` is existing debt that `checks-size-budget` stops from growing.
`checks-repetition` runs jscpd with the repository's own `.jscpd.json`, so its `path` and `ignore` globs decide which files are measured.

## Related topics

- [The Effect rules](effect-rules.md)
- [The CI wiring check](../gates/checks-ci-wiring.md)
- [The size budget](../gates/checks-size-budget.md)
