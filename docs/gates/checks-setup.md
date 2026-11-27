---
kind: reference
audience: consumers
---
# checks-setup

`checks-setup` writes the kit config, the workflow files and the doc templates into a repository that does not hold them yet.

## What it checks

A run writes each missing file and brings the files it finds up to what the checks need.
It adds the `node_modules/` line to `.gitignore` when the file lacks it.
It adds the kit entry and any missing script to a `package.json` it finds.
It writes `devDependencies` in package name order, as `bun add` does.
It replaces the kit version pin with its own version, and a `--private` run sets `private` to `true`.
It stops when an existing `lint` script does not match `oxlint && checks-lint`.
It stops when an existing `typecheck` script does not match `tsc --noEmit && effect-tsgo diagnostics --project tsconfig.json --format text --strict`.
It stops when a `test` script it finds is not `checks-test`, or a `test:fast` script is not `checks-test --changed`, and names the script to fix.
It also stops when a `test:<tier>` script is not `checks-test --tier=<tier>` or names a tier with no test files, or another `test:*` script exists.
It copies the fleet pin into `.bun-version` and the preset into `bunfig.toml`.
It writes `oxlint.config.ts`, `tsconfig.json` and `knip.config.ts` from the kit builders, with Effect rules on.
The fresh `tsconfig.json` enables `allowImportingTsExtensions` and `noEmit` so TypeScript can check the kit's source imports.
It adds the kit's `@types/bun` version to `devDependencies`, whether it writes `tsconfig.json` or keeps the one it finds.
It keeps an existing `@types/bun` dev dependency version.
The fresh `tsconfig.json` names `bun` in `types`.
It writes `.jscpd.json` with the kit default.
It writes the Effect paths of the `oxlint.config.ts` it finds or writes into the language service entry of `tsconfig.json`.
Setup loads the oxlint config and uses the same JSONC patch as [checks-effect-scope](checks-effect-scope.md).
The pair passes `checks-effect-scope --check` from the first write.
If an existing oxlint config imports packages, those imports must resolve before setup can read the paths.
Setup refuses the same unsupported scope patterns as `checks-effect-scope`.
It writes `package.json` with the kit in `devDependencies` and with `lint`, `typecheck`, `test` and `test:fast` scripts, plus a `test:<tier>` script for each tier that holds test files.
It writes the workflow files and local actions `checks-workflows` writes, and every one holds its own steps.
A repository whose workflow files already name a site gets the site set, and so does a run given the site name flags.
Any other repository gets the code set.
Each site workflow holds the Pages project, the domain and the production repository, taken from the site workflows it finds.
Each flag fills only a name no site workflow holds.
It stops before writing anything when a site run lacks one of the three names, and names the fix.
The same stop covers two values of one name, an unparsable name, and a flag that differs from a name its workflows hold.
The same stop covers a test job of `ci.yml` that holds an unparsable input or a name a job cannot take.
A freshly set up repository passes `checks-workflows` without running `--write` first.
In a code repository it writes `mutation.yml` under `.github/workflows/`, which splits the tree into shards, runs each shard and keeps the merged report as the baseline.
It starts by hand, as [checks-ci-wiring](checks-ci-wiring.md#schedules) requires.
No run starts after a merge to `main`.
It writes `stryker.conf.mjs`, which spreads the kit's Stryker preset and sets the `mutate` globs to the sources under `src/`.
It adds the kit's own pins of `@stryker-mutator/core` and `@hughescr/stryker-bun-runner` to `devDependencies`, and keeps a pin it finds.
It copies each kit template under `dist/templates/` into `templates/`, so a new doc file starts from a copy there.
It copies `dist/templates/agents.md` to `AGENTS.md` and `dist/templates/claude.md` to `CLAUDE.md` when the root lacks them, and keeps either file it finds.
If the root has no `VISION.md`, it copies `dist/templates/vision.md` there.
It leaves an existing `VISION.md` unchanged.
If the root has no `CHANGELOG.md`, it writes one with a title and a lead sentence, and keeps an existing one unchanged.
It names every file it wrote and every file it kept.
It tells the owner to declare the repository owners in `package.json` `author` or `contributors` before the first commit.

## What it reads

It reads the working tree, which is the repository it sets up.
It reads the `.yml` and `.yaml` files under `.github/workflows/` to tell a site from a code repository and to take the site names its workflows hold.
It reads a `package.json` it finds for the fields and scripts it keeps, replaces or refuses.
It reads `checks.config.ts` for the repository visibility that selects the workflow runners and for `releaseAssets`, which adds the `assets` job to `main.yml`, or to `release.yml` in the kit.
It also reads `platformPackages`, which adds the `binaries` job to `main.yml`.
It reads `extraTestJobs` for the extra test jobs, their environment variables, setup commands, and test commands in `ci.yml`.
It reads the workspace patterns and each workspace `package.json` for the workflow options the written manifest will hold.
It reads the kit install for `.bun-version`, `bunfig.toml`, its version, its Stryker pins, its `@types/bun` version, and each template.

## Arguments

```sh
checks-setup [--private] [--pages <project>] [--domain <domain>] [--production <owner/name>]
```

With no arguments the repository is public.
With `--pages`, `--domain` and `--production` the repository is a site with those names, and each flag must match the name the site workflows hold.
To rename a site, run `checks-workflows --write` with the flags.
The three flags set up a site that has no site workflow yet.
With `--private` it sets `private` to `true` in `package.json`.
For a private GitHub repository, set `repositoryVisibility: "private"` in `checks.config.ts` before running setup.
Then the run names the `CI_RUNS_ON` value to set.

## Exit codes

| Code | When |
| --- | --- |
| 0 | every file is written or already there |
| 2 | `extraTestJobs` does not decode, lists a job name twice, takes a reserved job name, or holds a setup or test command that is not plain, an argument is unknown, a site lacks one of its three names, passes two values of one, names one that does not parse, passes a flag that differs from the name a present workflow holds, a test job of `ci.yml` holds an unparsable input or a name a job cannot take, a caller passes an input the set cannot carry, `checks.config.ts` sets `releaseAssets` or `platformPackages` in a site, in a private repository or without a `release:assets` script in `package.json`, sets `platformPackages` in the kit or with a private `package.json` and no public workspace or more than one, a file it needs cannot be read, a retained `oxlint.config.ts` does not load or lacks a default config export, a scope, ignore pattern, or rule setting cannot be mirrored, a second oxlint config may change a scoped override, or a `lint`, `typecheck`, `test`, `test:fast` or `test:*` script it finds does not run the checks |

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
If setup writes `VISION.md`, fill its opening, stance sections, Scope and closing lines before the first commit.
Name the page once in `AGENTS.md`.
Commit `CHANGELOG.md` with the setup files so `checks-ci-wiring` can read it at `HEAD`.
Running setup again with the same kit version changes nothing.
A later kit release arrives through [Upgrade the kit](../how-to/upgrade-the-kit.md).

## Related topics

- [Set up a repository](../how-to/set-up-a-repository.md)
- [Upgrade the kit](../how-to/upgrade-the-kit.md)
