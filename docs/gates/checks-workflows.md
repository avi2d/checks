---
kind: reference
audience: consumers
---
# checks-workflows

`checks-workflows` holds a repository's workflow files to the set of shared-workflow callers its kind and its `ci.yml` jobs take, and `--write` writes that set.

## What it checks

Every workflow file in the set calls shared workflows in `avi2d/workflows`, so every step lives there once.
`ci.yml` composes the CI parts into jobs that run side by side, as [The composed ci.yml](#the-composed-ciyml) says.
Every other file is a short caller of one shared workflow.
A repository with a workflow file that calls `site-ci.yml`, `site-preview.yml`, `site-main.yml`, `site-production.yml` or `preview-remove.yml` from `avi2d/workflows` is a site.
Any other repository is a code repository, and `package.json` decides neither kind.

Each site caller of `site-main.yml`, `site-production.yml` and `preview-remove.yml` passes the three site names as inputs:

```yaml
    with:
      pages: "acme"
      domain: "acme.example"
      production: "acme/acme.example"
```

`pages` is the Cloudflare Pages project the previews and the staging site go to.
`domain` is the address the live site answers on.
`production` is the repository the live site publishes from, as `owner/name`.
The `site` job of a site's `ci.yml` passes `pages` alone to `site-preview.yml`.
The set takes the three names from the site callers the repository holds, so every site caller passes the same three.

A site takes these files under `.github/workflows/`:

| File | Event | Calls | Passes |
| --- | --- | --- | --- |
| `ci.yml` | a pull request opened, pushed to, reopened or marked ready for review, and `workflow_dispatch` | `changes.yml@v3`, `static.yml@v3`, `site-preview.yml@v3`, `test.yml@v3` and `gate.yml@v3` | `pages`, `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` to `site-preview.yml` |
| `pr-title.yml` | a pull request title edit | `pr-title.yml@v3` | no input and no secret |
| `preview-close.yml` | a pull request closed | `preview-remove.yml@v3` | the site names, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |
| `main.yml` | a push to `main` | `site-main.yml@v3` | the site names, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |
| `release.yml` | `workflow_dispatch` | `release-pr.yml@v3` | no input and no secret |
| `production.yml` | `workflow_dispatch` | `site-production.yml@v3` | the site names, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `PRODUCTION_DEPLOY_KEY` |

A code repository takes these files:

| File | Event | Calls |
| --- | --- | --- |
| `ci.yml` | a pull request opened, pushed to, reopened or marked ready for review, and `workflow_dispatch` | `changes.yml@v3`, `static.yml@v3`, `test.yml@v3` and `gate.yml@v3` |
| `pr-title.yml` | a pull request title edit | `pr-title.yml@v3` |
| `main.yml` | a push to `main` | `release-main.yml@v3` |
| `release.yml` | `workflow_dispatch` | `release-pr.yml@v3` |

The `ci.yml` caller runs one run per pull request and cancels the run a newer push replaces.
Each calling job grants exactly the permissions its shared job declares.
Each caller passes, by name, exactly the secrets its shared workflow declares under `workflow_call`, each as `NAME: ${{ secrets.NAME }}`.
A code caller passes no secret, since its shared workflow declares none.
GitHub passes `secrets: inherit` only to a workflow in the same organization or enterprise, so a caller that holds it differs from the set.
The release, site main and production callers hold no concurrency group, since their shared jobs hold their own.
The code main caller holds group `main` without cancellation, since `release-main.yml` holds no group.
Every file a code repository takes except `ci.yml` is byte-identical in every code repository.
The files a site takes differ between sites only in the three names they pass, the test jobs of `ci.yml` and whether `ci.yml` holds the `changes` job.
A code repository's `ci.yml` differs from another only in its test jobs and whether it holds the `changes` job.
`pr-title.yml` and `release.yml` are the same in both kinds.

`pr-text.yml` stays as it is in both kinds.
It runs on `pull_request_target` and comment events, so no `ci.yml` caller replaces it.
`checks-workflows` never compares it, `--write` neither writes nor deletes it, and it is no extra.
A by-hand caller may be absent, but a present one holds exactly its caller form, which starts only on `workflow_dispatch`.
A site may hold `advisories.yml`.
A code repository may hold `advisories.yml`, `mutation.yml` and `flake.yml`, and its `mutation.yml` is the caller [checks-setup](checks-setup.md) writes.

It fails when a file of the set is missing or differs by a byte, or when a workflow file outside the set appears.
In a site it also fails when the site callers miss a name, pass two values of one, or pass one that does not parse.
It also fails when a test job of `ci.yml` passes an input that does not parse, or holds the name of a fixed job.
The message names the callers or the flags that fix it.
Each difference names the file, and each changed line names what the file holds and what the caller holds.
The `avi2d/workflows` repository holds the shared workflows, so there it passes and keeps its own files.

## The composed ci.yml

`ci.yml` holds one job per concern, and each job calls one CI part:

| Job | Calls | Runs |
| --- | --- | --- |
| `changes` | `changes.yml` | first, and tells whether the pull request changes only documentation |
| `static` | `static.yml` | at once, and checks the workflow files and the title, builds, lints and typechecks |
| `site` | `site-preview.yml` | in a site, after `changes`, and builds the site, deploys the preview and uploads the build as `site-dist` |
| each test job | `test.yml` | after `changes`, or after `site` when it reads the build, and runs its one command |
| `checks` | `gate.yml` | always, after every other job, and fails unless each one passed or skipped as allowed |

The gate job is named `checks` and its shared job is named `checks`, so branch protection reads `checks / checks`.
On a pull request that changes only documentation, the `site` job and the test jobs skip, and the gate passes those skips.
A repository with no `changes` job runs every job on every pull request.
On the release pull request, whose `release/` branch [checks-release-pr](checks-release-pr.md) dispatches `ci` on, every job but `checks` skips, and the gate passes those skips.
So the release pull request runs nothing, and its required check still passes.
Each job that needs no other job tests the branch in its `if`, and every other job skips with the job it needs.

The jobs `ci.yml` holds are the record of what the repository runs, and `package.json` names none of them.
A `ci.yml` that calls a part keeps its `changes` job, or its lack of one, and each job that calls `test.yml`, with its name.
Each test job keeps the `run`, `browsers`, `heavy` and `runs-on` inputs it passes.
A test job that passes no `runs-on` gets the `CI_RUNS_ON` one, and a `run`, `browsers` or `heavy` input equal to the `test.yml` default is left out, such as `run: bunx checks-test --pr`.
In a site, a test job that passes `artifact: "site-dist"` reads the build, so it waits for the `site` job.
`static`, `site` in a site and `checks` are always there, and no test job is named `changes`, `static`, `site` or `checks`.
Every other line of the file is the shape the kit writes: the order of the jobs, `needs`, `if`, the pins, the permissions, the secrets and `hold`.
In a site, `static` and each test job that does not read the build pass `hold: false`, so a draft still gets its preview link.

A `ci.yml` that calls no part gets the default jobs of its kind:

| Kind | Default test jobs |
| --- | --- |
| code | `test`, which runs `bunx checks-test --pr` |
| site | `unit`, which runs `bunx checks-test --pr`, and `browser`, which runs `bunx checks-browser --pr` on `webkit` against the `site-dist` build and holds the heavy slot |

Both kinds also get the `changes` job by default.
Each default test job passes `runs-on: "${{ vars.CI_RUNS_ON || 'ubuntu-latest' }}"`, so the `CI_RUNS_ON` variable picks the runner.

To add a test job, add a job to `ci.yml` that calls `test.yml` and passes its command, then run `checks-workflows --write`:

```yaml
  e2e:
    uses: avi2d/workflows/.github/workflows/test.yml@v3
    with:
      run: bun run test:e2e
```

A single-job `ci.yml` that calls `ci.yml@v3` or `site-ci.yml@v3` still passes.
It passes until `checks-workflows --write` replaces it with the composed `ci.yml`, and each passing run names that command.

## What it reads

It reads the `.yml` and `.yaml` files under `.github/workflows/` from the repository root.
It names the repository by `GITHUB_REPOSITORY`, or by the `origin` remote outside CI.

## Arguments

```sh
checks-workflows
checks-workflows --write
checks-workflows --write --pages acme --domain acme.example --production acme/acme.example
```

With `--write` it writes every file of the set, rewrites a present by-hand caller to its caller form, and deletes every other workflow file except `pr-text.yml`.
It writes `ci.yml` with the jobs the present `ci.yml` holds, in the shape the kit writes.
A rewrite of a site keeps the three names its callers pass.
`--pages`, `--domain` and `--production` name a site with no site caller yet, and each replaces the name the callers pass.
A site write with a missing name, two values of one, or an unparsable name writes nothing.
It names the fix.

## Exit codes

| Code | When |
| --- | --- |
| 0 | the workflow files are the set, or `--write` wrote it |
| 1 | a file of the set is missing or differs, another workflow file appears, the site callers pass none, two values or an unparsable value of a name, or a test job of `ci.yml` passes an unparsable input or holds a fixed job's name |
| 2 | the arguments do not parse, a workflow file cannot be read, a site write lacks one of the three names, passes two values of one, or names one that does not parse, or a test job of `ci.yml` passes an unparsable input or holds a fixed job's name |

## Sample output

```
workflows: .github/workflows differs from the code set in 2 file(s):
  .github/workflows/ci.yml: differs from the caller checks-workflows writes
    line 10: holds "  cancel-in-progress: false", the caller holds "  cancel-in-progress: true"
  .github/workflows/pages.yml: no workflow of the set, so delete it
  run checks-workflows --write to write the set
```

## When it runs

The `static` job of a composed `ci.yml` runs `bunx checks-workflows`, and so does the `checks` job of the single-job `ci.yml@v3` and `site-ci.yml@v3`.
So a pull request that edits a caller or adds a workflow file fails.
[checks-ci-wiring](checks-ci-wiring.md) accepts the set as running every gate it requires, since the shared workflows run them.

## Related topics

- [checks-ci-wiring](checks-ci-wiring.md)
- [checks-release-tag](checks-release-tag.md)
- [checks-production-gate](checks-production-gate.md)
