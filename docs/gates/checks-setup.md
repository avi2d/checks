---
kind: reference
audience: consumers
---
# checks-setup

`checks-setup` writes the kit config, the CI and mutation workflows and the doc templates into a repository that does not hold them yet.

## What it checks

A run writes each missing file and brings the files it finds up to what the checks need.
It adds the `node_modules/` line to `.gitignore` when the file lacks it.
It adds the kit entry and any missing script to a `package.json` it finds.
It replaces the kit version pin with its own version, and a `--private` run sets `private` to `true`.
It stops when a `lint` script it finds does not run oxlint and the layout check, and names the script to fix.
It stops when a `typecheck` script it finds does not run the Effect diagnostics, and names the script to fix.
It stops when a `test` script it finds is not the kit suite, and names the script to fix.
It copies the fleet pin into `.bun-version` and the preset into `bunfig.toml`.
It writes `oxlint.config.ts`, `tsconfig.json` and `knip.config.ts` from the kit builders, with Effect rules on.
It writes `.jscpd.json` with the kit default.
It writes the Effect paths of the `oxlint.config.ts` it finds or writes into the language service entry of `tsconfig.json`.
The pair passes `checks-effect-scope --check` from the first write.
It writes `package.json` with the kit in `devDependencies` and with `lint`, `typecheck` and `test` scripts.
It writes `.github/workflows/ci.yml`, which installs with `bun install --frozen-lockfile` and then runs the `build` script when the manifest holds one.
The workflow always runs `bun run lint`, `bun run typecheck` and `bun run test`.
A `build` script there also brings a `git diff --exit-code` step.
Other scripts a `package.json` it finds already holds stay, but the workflow never schedules them.
The workflow always ends with a `bunx checks-commit-title` step for the pull request title.
It runs on pull requests alone, so a merge to the default branch does not run the suite a second time.
A newer push to the same pull request cancels the run in progress.
A `--private` run pins each job to `${{ vars.CI_RUNS_ON || 'ubuntu-latest' }}`.
Setting the `CI_RUNS_ON` variable to a self-hosted runner label then lands the jobs there.
A public run pins each job to `ubuntu-latest`.
It writes `mutation.yml` under `.github/workflows/`, which calls the shared mutation workflow `avi2d/workflows/.github/workflows/mutation.yml@v1`.
A pull request runs it in `compare` mode.
A push to `main` that touches `src/`, `tests/unit/`, the Stryker config, the manifest, the lockfile or the Bun pins runs it in `baseline` mode.
A dispatch runs `baseline` or, by its `mode` input, `refresh`, so a refresh starts by hand as [checks-ci-wiring](checks-ci-wiring.md#schedules) requires.
It writes `stryker.conf.mjs`, which spreads the kit's Stryker preset and sets the `mutate` globs to the sources under `src/`.
It adds the kit's own pins of `@stryker-mutator/core` and `@hughescr/stryker-bun-runner` to `devDependencies`, and keeps a pin it finds.
It copies each kit template under `dist/templates/` into `templates/`, so a new doc file starts from a copy there.
It copies `dist/templates/agents.md` to `AGENTS.md` and `dist/templates/claude.md` to `CLAUDE.md` when the root lacks them, and keeps either file it finds.
It names every file it wrote and every file it kept.
It tells the owner to declare the repository owners in `package.json` `author` or `contributors` before the first commit.

## What it reads

It reads the working tree, which is the repository it sets up.
It reads a `package.json` it finds for the fields and scripts it keeps, replaces or refuses.
It reads the kit install for `.bun-version`, `bunfig.toml`, its version, its Stryker pins and each template.

## Arguments

```sh
checks-setup [--private]
```

With no arguments the repository is public, and its jobs run on `ubuntu-latest`.
With `--private` the jobs read the `CI_RUNS_ON` variable, and the run names the value to set.

## Exit codes

| Code | When |
| --- | --- |
| 0 | every file is written or already there |
| 2 | an argument is unknown, a file it needs cannot be read, or a `lint`, `typecheck` or `test` script it finds does not run the checks |

## Sample output

```
checks-setup: wrote .bun-version
checks-setup: kept oxlint.config.ts, already there
checks-setup: declare the repository owners in package.json author or contributors before the first commit
checks-setup: set the CI_RUNS_ON variable to a self-hosted runner label so the new jobs land there
```

## When it runs

A repository owner runs it once in a new repository, before the first install.
Declare the repository owners in `package.json` `author` or `contributors` before the first commit.
Fill `AGENTS.md` with what an agent cannot infer from the code before the first commit.
`checks-docs` fails on the unfilled placeholder entry until it is filled.
Running it again with the same kit version changes nothing.
A later kit release arrives through [Upgrade the kit](../how-to/upgrade-the-kit.md).

## Related topics

- [Set up a repository](../how-to/set-up-a-repository.md)
- [Upgrade the kit](../how-to/upgrade-the-kit.md)
