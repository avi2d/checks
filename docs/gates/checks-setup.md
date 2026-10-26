---
kind: reference
audience: consumers
---
# checks-setup

`checks-setup` writes the kit config, the CI workflow and the doc templates into a repository that does not hold them yet.

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
It writes the Effect paths of the `oxlint.config.ts` it finds or writes into the language service entry of `tsconfig.json`.
The pair passes `checks-effect-scope --check` from the first write.
It writes `package.json` with the kit in `devDependencies` and with `lint`, `typecheck` and `test` scripts.
It writes `.github/workflows/ci.yml`, which installs with `bun install --frozen-lockfile` and then runs the `build` script when the manifest holds one.
The workflow always runs `bun run lint`, `bun run typecheck` and `bun run test`.
A `build` script there also brings a `git diff --exit-code` step.
Other scripts a `package.json` it finds already holds stay, but the workflow never schedules them.
The workflow always ends with a `bunx checks-commit-title` step for the pull request title.
A `--private` run pins each job to `${{ vars.CI_RUNS_ON || 'ubuntu-latest' }}`.
Setting the `CI_RUNS_ON` variable to a self-hosted runner label then lands the jobs there.
A public run pins each job to `ubuntu-latest`.
It copies each kit template under `dist/templates/` into `templates/`, so a new doc file starts from a copy there.
It names every file it wrote and every file it kept.
It tells the owner to declare the repository owners in `package.json` `author` or `contributors` before the first commit.

## What it reads

It reads the working tree, which is the repository it sets up.
It reads a `package.json` it finds for the fields and scripts it keeps, replaces or refuses.
It reads the kit install for `.bun-version`, `bunfig.toml`, its version and each template.

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
Running it again with the same kit version changes nothing.
A later kit release arrives through [Upgrade the kit](../how-to/upgrade-the-kit.md).

## Related topics

- [Set up a repository](../how-to/set-up-a-repository.md)
- [Upgrade the kit](../how-to/upgrade-the-kit.md)
