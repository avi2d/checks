---
kind: reference
audience: consumers
---
# checks-workflows

`checks-workflows` holds a repository's workflow files and local actions to the set its kind and its `ci.yml` jobs take, and `--write` writes that set.

## What it checks

Every file of the set holds its own steps, and no job calls a workflow of another repository.
Each step that needs more than one plain command runs `bunx checks-ci <command>`, as [checks-ci](checks-ci.md) says.
`ci.yml` composes the jobs that run side by side, as [The composed ci.yml](#the-composed-ciyml) says.
A repository whose workflow files set the workflow `env` `SITE_PAGES`, `SITE_DOMAIN` or `SITE_PRODUCTION` is a site.
A job that calls `site-ci.yml`, `site-main.yml`, `site-production.yml`, `site-preview.yml` or `preview-remove.yml` also marks the repository a site.
Any other repository is a code repository, and `package.json` decides neither kind.

The site workflows hold the three site names as the workflow `env`:

```yaml
env:
  SITE_PAGES: acme
  SITE_DOMAIN: acme.example
  SITE_PRODUCTION: acme/acme.example
```

`SITE_PAGES` is the Cloudflare Pages project the previews and the staging site go to.
`SITE_DOMAIN` is the address the live site answers on.
`SITE_PRODUCTION` is the repository the live site publishes from, as `owner/name`.
The set takes the three names from the site workflows the repository holds, so every site workflow names the same three.

A site takes these files under `.github/workflows/`:

| File | Event | Runs |
| --- | --- | --- |
| `ci.yml` | a pull request opened, pushed to, reopened or marked ready for review, and `workflow_dispatch` | the composed jobs, with a `site` job that builds the site and deploys the preview |
| `pr-title.yml` | every push to a pull request and every title edit | the title check, posted as the `commitlint` status |
| `preview-close.yml` | a pull request closed | the removal of the pull request's preview |
| `main.yml` | a push to `main` | the staging deploy |
| `release.yml` | `workflow_dispatch` | the release pull request |
| `production.yml` | `workflow_dispatch` | the production deploy |

A code repository takes these files:

| File | Event | Runs |
| --- | --- | --- |
| `ci.yml` | a pull request opened, pushed to, reopened or marked ready for review, and `workflow_dispatch` | the composed jobs |
| `pr-title.yml` | every push to a pull request and every title edit | the title check, posted as the `commitlint` status |
| `main.yml` | a push to `main` | `bunx checks-release-tag`, which tags and publishes a release commit |
| `release.yml` | `workflow_dispatch` | the release pull request |

A code repository whose `package.json` does not set `private: true` publishes to npm.
Then its `main.yml` holds a `suite` job that runs `bun run test --full` once on a release commit before the tag and the publish.
A repository without a `package.json` counts as one that publishes.
A private root with public workspace packages also holds the `suite` job and sets `CHECKS_PUBLISH_WORKSPACES: "true"` on the release step.
A private root with a `test` script also holds the `suite` job, and its `ci.yml` runs static checks and tests on release pull requests.
A Claude Code version pinned by an install step in `ci.yml` or `flake.yml` is kept in the test and flake jobs.

The `ci.yml` run is one run per pull request, and a newer push cancels the run it replaces.
The code `main.yml` release job holds group `main` without cancellation.
Every file a code repository takes except `ci.yml` and `main.yml` is byte-identical in every code repository.
The files a site takes differ between sites only in the three names, the test jobs of `ci.yml`, and the Claude Code version.
A job that runs the suite cancels its run when a push to a draft pull request started it.
In a site only the jobs that read the build do so, so a draft still gets its preview link.
The kit itself keeps its own `release.yml` and `release-pr.yml`, since npm's trusted publishing names `release.yml`.
A job in those files that calls another repository's workflow is still refused.
Replace it with its own steps by hand.

`pr-text.yml` stays as it is in both kinds.
It runs on `pull_request_target` and comment events, so no `ci.yml` job replaces it.
`checks-workflows` never compares it, `--write` neither writes nor deletes it, and it is no extra.
The refusal of a call to another repository's workflow still reads it.
Replace a job that calls another repository's workflow with its own steps by hand.

An optional file may be absent, but a present one holds exactly the file the set writes.
A site may hold `advisories.yml` and `docs.yml`.
A code repository may hold `advisories.yml`, `mutation.yml`, `flake.yml` and `docs.yml`.
Each optional file keeps what the file it replaces does:

| File | Starts on | Keeps |
| --- | --- | --- |
| `advisories.yml` | `workflow_dispatch` | its `schedule` cron when it holds exactly one and that one is weekly, such as `"21 5 * * 1"`, and drops any other schedule |
| `mutation.yml` | `workflow_dispatch` and `workflow_call` | nothing, since it is the same in every code repository: it splits the tree into shards, runs each shard and merges the reports. Only a `workflow_dispatch` run keeps the merged report as the baseline. A run started through `workflow_call` uses the report only within that run |
| `flake.yml` | `workflow_dispatch` | the `node-version-file` an `actions/setup-node` step sets up |
| `docs.yml` | a push to `main` and `workflow_dispatch` | the one `run` step and the `actions/upload-pages-artifact` path of the job that uploads the site |

A `docs.yml` that gives no build step and path is no workflow of the set.
Its deploy job holds group `github-pages-deploy`, so a second deploy waits for the one in flight.

The set also takes the local actions its workflows use:

| File | Holds |
| --- | --- |
| `.github/actions/setup/action.yml` and `bun-without-unzip.sh` | the install of the Bun `.bun-version` pins, through npm where the image holds no unzip, and of the locked dependencies, after the job checks out the repository |
| the `playwright` action under `.github/actions/` | the install of the Playwright browsers and their system packages, written in a site or when a test job installs browsers |

It fails when a workflow or action file of the set is missing or differs by a byte.
It also fails when a workflow file outside the set appears.
It also fails when a job calls a workflow of another repository, such as `owner/name/.github/workflows/ci.yml@v1`, and names each such job.
In a site it also fails when the site workflows miss a name, hold two values of one, or hold one that does not parse.
It also fails when a test job of `ci.yml` holds an input that does not parse, or holds a name a job cannot take.
The message names the flags that fix it.
Each difference names the file, and each changed line names what the file holds and what `checks-workflows` writes.

## The composed ci.yml

`ci.yml` holds one job per concern:

| Job | Runs |
| --- | --- |
| `changes` | first, and tells whether the run checks the release pull request and whether the pull request changes only documentation |
| `static` | after `changes`, and checks the workflow files, lints, builds and typechecks |
| `site` | in a site, after `changes`, and builds the site, deploys the preview and uploads the build as `site-dist` |
| each test job | after `changes`, or after `site` when it reads the build, and runs its one command in the step whose id is `test` |
| `checks` | always, after every other job, and fails unless each one passed or skipped as allowed |

Branch protection reads the gate job as `checks`.
On a dispatched run, the `checks` job posts its result as the `checks` status and the title as the `commitlint` status.
On a pull request that changes only documentation, the `site` job and the test jobs skip, and the gate passes those skips.
Only two runs count as the release pull request.
One is the `workflow_dispatch` run on a `release/` branch, which [checks-release-pr](checks-release-pr.md) dispatches.
The other is the same repository pull request from `release/<base>` into `<base>`.
On those runs every job but `changes` and `checks` skips, unless the repository is a private root with a `test` script.
Then the static and test jobs run on the release pull request, and the gate does not accept their skips.
The default test command becomes `bun run test` there.
A fork pull request from a `release/` branch and a pull request from a `release/` branch that does not match `release/<base>` run every job.
Each job reads the rule once from the `release` output of `changes`, as `if: needs.changes.outputs.release != 'true'`.

The jobs `ci.yml` holds are the record of what the repository runs, and `package.json` names none of them.
A job whose step with id `test` runs a command is a test job.
It keeps its name, that command, the browsers its `playwright` step installs, and its `runs-on`.
In a site, a test job that needs `site` reads the build.
`changes`, `static`, `site` in a site and `checks` are always there.
Every other line of the file is the shape the kit writes: the order of the jobs, `needs`, `if`, the pins and the permissions.
A `ci.yml` with a step that runs `bunx checks-ci secrets-pack` keeps that step in `static`, which unpacks the `CHECKS_SECRETS_PACK` secret before lint.

A `ci.yml` with no test job gets the default jobs of its kind:

| Kind | Default test jobs |
| --- | --- |
| code | `test`, which runs `bunx checks-test --pr` |
| site | `unit`, which runs `bunx checks-test --pr`, and `browser`, which runs `bunx checks-browser --pr` on `webkit` against the `site-dist` build |

Each default test job runs on `${{ vars.CI_RUNS_ON || 'ubuntu-latest' }}`, so the `CI_RUNS_ON` variable picks the runner.

To add a test job, copy the `test` job of `ci.yml` under a new name, change the `run` of its step with id `test`, then run `checks-workflows --write`.

## What it reads

It reads the `.yml` and `.yaml` files under `.github/workflows/` and the files under `.github/actions/` from the repository root, and the root and workspace `package.json` files.

## Arguments

```sh
checks-workflows
checks-workflows --write
checks-workflows --write --pages acme --domain acme.example --production acme/acme.example
```

With `--write` it writes every file of the set and its actions, and rewrites a present optional file to the file the set writes.
It deletes every other workflow file except `pr-text.yml`.
It writes `ci.yml` with the jobs the present `ci.yml` holds, in the shape the kit writes.
A rewrite of a site keeps the three names its workflows hold.
A job that calls `site-ci.yml`, `site-main.yml`, `site-production.yml`, `site-preview.yml` or `preview-remove.yml` passes the three names in `with`, and `--write` keeps them as the site names.
A job that calls the shared `test.yml` keeps its `run`, its `browsers` and its `runs-on`.
A caller input the set cannot carry refuses the write, and the message names the input.
`--pages`, `--domain` and `--production` name a site with no site workflow yet, and each replaces the name the workflows hold.
A site write with a missing name, two values of one, or an unparsable name writes nothing.
It names the fix.

## Exit codes

| Code | When |
| --- | --- |
| 0 | the workflow files are the set, or `--write` wrote it |
| 1 | a file of the set is missing or differs, another workflow file appears, a job calls a workflow of another repository, the site workflows hold none, two values or an unparsable value of a name, a test job of `ci.yml` holds an unparsable input or a name a job cannot take, or a caller passes an input the set cannot carry |
| 2 | the arguments do not parse, a workflow file or `package.json` cannot be read, a site write lacks one of the three names, holds two values of one, or names one that does not parse, a test job of `ci.yml` holds an unparsable input or a name a job cannot take, or a caller passes an input the set cannot carry |

## Sample output

```
workflows: .github/workflows differs from the code set in 2 file(s):
  .github/workflows/ci.yml: differs from the file checks-workflows writes
    line 10: holds "  cancel-in-progress: false", checks-workflows writes "  cancel-in-progress: true"
  .github/workflows/pages.yml: no file of the set, so delete it
  run checks-workflows --write to write the set
```

## When it runs

The `static` job of `ci.yml` runs `bunx checks-workflows`.
So a pull request that edits a workflow file or adds one fails.
[checks-ci-wiring](checks-ci-wiring.md) accepts the set as running every gate it requires.

## Related topics

- [checks-ci](checks-ci.md)
- [checks-ci-wiring](checks-ci-wiring.md)
- [checks-release-tag](checks-release-tag.md)
- [checks-production-gate](checks-production-gate.md)
