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
| `ci.yml` | a pull request opened, pushed to, reopened or marked ready for review, a push to `main`, and `workflow_dispatch` | the composed jobs, with a `site` job that builds the site and deploys the preview |
| `pr-title.yml` | every push to a pull request and every title edit | the title check, posted as the `commitlint` status |
| `preview-close.yml` | a pull request closed | the removal of the pull request's preview |
| `main.yml` | a push to `main` | the staging deploy |
| `release.yml` | `workflow_dispatch` | the release pull request |
| `production.yml` | `workflow_dispatch` | the production deploy |
| `mutation.yml` | `workflow_dispatch` and `workflow_call` | the full mutation refresh |
| `pr-text.yml` | in a public repository, every change to a pull request's text | the scan [checks-pr-text](checks-pr-text.md) runs, posted as the `pr-text` status |
| `whole-tree-run.yml` | `workflow_dispatch` | the whole-tree run and issue filing |

A code repository takes these files:

| File | Event | Runs |
| --- | --- | --- |
| `ci.yml` | a pull request opened, pushed to, reopened or marked ready for review, a push to `main`, and `workflow_dispatch` | the composed jobs |
| `pr-title.yml` | every push to a pull request and every title edit | the title check, posted as the `commitlint` status |
| `main.yml` | a push to `main` | `bunx checks-release-tag`, which tags and publishes a release commit |
| `release.yml` | `workflow_dispatch` | the release pull request |
| `mutation.yml` | `workflow_dispatch` and `workflow_call` | the full mutation refresh |
| `pr-text.yml` | in a public repository, every change to a pull request's text | the scan [checks-pr-text](checks-pr-text.md) runs, posted as the `pr-text` status |
| `whole-tree-run.yml` | `workflow_dispatch` | the whole-tree run and issue filing |

The kit requires neither `mutation.yml` nor `whole-tree-run.yml`.
It may hold `mutation.yml` as an optional file, but `whole-tree-run.yml` is outside its set.

A code repository whose `package.json` does not set `private: true` publishes to npm.
Then its `main.yml` holds a `suite` job that runs `bun run test --full` once on a release commit before the tag and the publish.
The code `main.yml` suite job and the site `production.yml` job cache and install the pinned gitleaks before running `bun run test --full`.
A repository without a `package.json` counts as one that publishes.
A private root with public workspace packages also holds the `suite` job and sets `CHECKS_PUBLISH_WORKSPACES: "true"` on the release step.
A private root with a `test` script also holds the `suite` job, and its `ci.yml` runs static checks and tests on release pull requests.
Its `ci.yml` runs the docs build there when `package.json` defines `docs:build`.
A Claude Code version pinned by an install step in `ci.yml` or `flake.yml` is kept in the test and flake jobs.
The `testTierShards` setting splits a default unit or e2e test job into matrix jobs while the `checks` job keeps its name.
Each configured tier must have a default job for that tier.
The command refuses a key without that default job, including a custom command with `--parallel`.
[checks-test](checks-test.md#parallel-runs) describes the setting and file assignment.

For a pull request, a newer push cancels the `ci.yml` run it replaces.
Pushes to `main` and manual dispatches each start a separate run.
The code `main.yml` release job holds group `main` without cancellation.
Only the fork-reachable jobs and `pr-text.yml` differ with repository visibility, with the test jobs of `ci.yml` and the Claude Code version.
The files a site takes also differ in the three site names.
A job that runs the suite cancels its run when a push to a draft pull request started it.
In a site only the jobs that read the build do so, so a draft still gets its preview link.
The kit keeps its own `release-pr.yml` because npm trusted publishing names `release.yml`.
With `releaseAssets` enabled, `checks-workflows` writes the kit's `release.yml` with an `assets` job after `github-release`.
A job in those files that calls another repository's workflow is still refused.
Replace it with its own steps by hand.

A public repository takes `pr-text.yml` in both kinds, and the kit takes the same file.
It runs on `pull_request_target`, `issue_comment`, `pull_request_review`, and `pull_request_review_comment`, so no `ci.yml` job replaces it.
GitHub runs `pull_request_target` and `issue_comment` from the default branch's copy of the file, so workflow changes take effect after merge.
The `pull_request_review` and `pull_request_review_comment` events run the pull request's copy from its merge ref.
Those review events get secrets only for a same-repository pull request, so the job skips fork reviews.
The kit's suite checks the file it writes before a consumer merges it.
A private repository's pull request text reaches no public reader, so its set takes no `pr-text.yml`.
There `checks-workflows` never compares one it holds, `--write` neither writes nor deletes it, and it is no extra.
The refusal of a call to another repository's workflow still reads it.
Replace a job that calls another repository's workflow with its own steps by hand.

An optional file may be absent, but a present one holds exactly the file the set writes.
A site may hold `advisories.yml` and `docs.yml`.
A code repository may hold `advisories.yml`, `flake.yml` and `docs.yml`.
The kit may also hold `mutation.yml`, which starts on `workflow_dispatch` or `workflow_call` and keeps the full mutation refresh.
Each optional file keeps what the file it replaces does:

| File | Starts on | Keeps |
| --- | --- | --- |
| `advisories.yml` | `workflow_dispatch` | its `schedule` cron when it holds exactly one and that one is weekly, such as `"21 5 * * 1"`, and drops any other schedule |
| `flake.yml` | `workflow_dispatch`, plus `schedule` when `flakeCron` is set | the `node-version-file` an `actions/setup-node` step sets up |
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

### Flake schedule

Set `flakeCron` in `checks.config.ts` to schedule the flake workflow in a code repository:

```ts
export default defineConfig({
  flakeCron: "23 5 * * 1",
});
```

The setting takes one five-field GitHub Actions cron expression in UTC that runs at most once a day.
The minute must be one number from 0 to 59, and the hour must be one number from 0 to 23.
Run `bunx checks-workflows --write` to create or update `flake.yml`.
The schedule runs on the default branch, and `workflow_dispatch` still starts the workflow by hand.
Without `flakeCron`, the workflow is optional and starts only by hand.

### Release a chosen version

`checks-workflows` keeps an optional string input named `version` on the `workflow_dispatch` of `release.yml`.
The release step sets `CHECKS_RELEASE_VERSION: ${{ inputs.version }}` under `env` and still runs `bunx checks-release-pr ci.yml`.
[checks-release-pr](checks-release-pr.md) plans the version from that variable, or plans the automatic bump when the variable is empty.
GitHub substitutes expressions in `run` before the shell parses the script.
`checks-workflows` refuses a `release.yml` that puts the input in `run`.
The job grants `contents: write`, `pull-requests: write`, and `actions: write` with or without the input.
Without the opt-in, the generated `release.yml` has no `inputs` or `CHECKS_RELEASE_VERSION`.

To opt in:

1. Raise the `@avi2dg/checks` range in `package.json` to a version that supports the input.
2. Run `bun install`.
3. Add the input to `.github/workflows/release.yml`:

   ```yaml
   on:
     workflow_dispatch:
       inputs:
         version:
           type: string
   ```

4. Run `bunx checks-workflows --write` to write the input and the step that reads it.
5. Merge the dependency and workflow changes to the default branch.
6. Run `gh workflow run release.yml -f version=X.Y.Z` on the default branch.

A run without `-f version` plans the bump the unreleased changes need.

### Attach release assets

Set `releaseAssets: true` in `checks.config.ts` to attach built files to each GitHub release of a code repository.
The setting defaults to `false`, and without it `main.yml` holds no `assets` job.
With it, `main.yml` holds an `assets` job after the `release` job.

The `release` job sets a `tag` output once `checks-release-tag` writes the GitHub release, and the `assets` job runs only when that output is set.
It runs once on `ubuntu-latest`, a Linux x64 runner, and once on `macos-latest`, a macOS arm64 runner.
Each run checks out the released tag, sets up Bun, and runs `bun run release:assets`.
It then runs `gh release upload` with `--clobber` for every file in `release-assets/`, so a rerun replaces the files it attached before.
The job grants only `contents: write`.

The `release:assets` script in `package.json` writes the files to attach into `release-assets/` at the repository root.
Each run attaches only what its own runner built.
So the script writes each compiled file and its SHA-256 file under a name that holds the platform, such as `<name>-<os>-<arch>` and `<name>-<os>-<arch>.sha256`.
A file of one name from both runners replaces the other on the release.
A release then holds a compiled file and its SHA-256 file for each platform.

In the kit, `release.yml` builds both platforms before it publishes to npm.
After the `github-release` job, the `assets` job attaches the files from those builds.

`checks-workflows` refuses the setting when `package.json` has no `release:assets` script, in a site, and when `repositoryVisibility` is `private`.

### Publish platform packages

Set `platformPackages` in `checks.config.ts` to publish a compiled binary to npm as one package per platform, the way the kit publishes its own:

```ts
export default defineConfig({
  platformPackages: { binary: "acme", platforms: ["darwin-arm64", "linux-x64"] },
});
```

`binary` is the name `bun run release:assets` gives each compiled file.
`platforms` lists the platforms to build and publish, each once.
A private root must have exactly one public workspace, which becomes the main package.
The root defines `release:assets`, and its version must match the workspace version.
Without the setting, `main.yml` holds no `binaries` job and stays as it was.

Each platform builds on its own GitHub-hosted runner:

| Platform | Runner | npm `os`, `cpu` and `libc` |
| --- | --- | --- |
| `darwin-arm64` | `macos-latest` | `darwin`, `arm64` |
| `darwin-x64` | `macos-15-intel` | `darwin`, `x64` |
| `linux-arm64` | `ubuntu-24.04-arm` | `linux`, `arm64`, `glibc` |
| `linux-x64` | `ubuntu-latest` | `linux`, `x64`, `glibc` |

With the setting, `main.yml` holds a `binaries` job that runs on a release commit, once on each platform's runner.
Each run checks out the release commit, sets up Bun and runs `bun run release:assets`.
The script writes the binary for its own runner as `release-assets/<binary>-<os>-<cpu>`, such as `release-assets/acme-linux-x64`.
The run uploads the files in `release-assets/` whose names start with `<binary>-`.
The `release` job waits for the `binaries` job and does not run when it fails.
It downloads the binaries into the runner's temporary directory and names that directory in `CHECKS_PLATFORM_BINARIES` on the `checks-release-tag` step.
The `binaries` job reads the subject of the pushed commit, so a push that releases an earlier release commit builds no binaries.
`checks-release-tag` then refuses before it tags anything and names the release commit, so rerun that commit's own main run.

[checks-release-tag](checks-release-tag.md) then stages and publishes the packages before it publishes the main package.
The main package is the root `package.json`, or under a private root the public workspace's `package.json`, such as `packages/run/package.json`:

1. It stages one package per platform, named `<name>-<os>-<cpu>` after the `name` of the main package, such as `@acme/cli-linux-x64`.
   The package holds only the binary, as `<binary>-<version>`, and sets `os`, `cpu` and, on Linux, `libc`.
   It takes `version`, `license`, `repository` and `publishConfig` from the main package.
2. It publishes each platform package.
3. It adds each platform package at the same version to `optionalDependencies` in the main package's `package.json`.
4. It publishes the main package.

The release job publishes every package through npm trusted publishing, which signs each with provenance and needs no token.
npm takes a trusted publish only for a package that already exists, so publish each new platform package once by hand.
Then add `main.yml` as its trusted publisher on npmjs.com.
A rerun skips each version npm already holds.

The main package's command finds the binary itself, as the kit's launcher in `src/core/native-launch.ts` does.
It resolves `<name>-<os>-<cpu>/<binary>-<version>` from its install and runs that file.
When no platform package matches the host, it runs its source.
npm installs only the optional dependency whose `os`, `cpu` and `libc` match the host, so an install runs no `postinstall` script and downloads one binary.

`checks-workflows` refuses the setting when the root has no `release:assets` script, in a site, in the kit, and when `repositoryVisibility` is `private`.
It also refuses a private root without exactly one public workspace.

### Add a test job with its own setup

Set `extraTestJobs` in `checks.config.ts` to add a test job that needs its own environment or a tool installed first:

```ts
export default defineConfig({
  extraTestJobs: [
    {
      name: "sandbox",
      env: { SANDBOX_TESTS: "1" },
      setup: ["npm install --global acme-sandbox@1.2.3"],
      run: "bunx checks-test --tier=live",
    },
  ],
});
```

`name` is the id of the job in `ci.yml`.
`env` sets environment variables on the job, so the setup and test commands both read them.
`setup` lists commands that each run in a step of their own, in order, before the test command.
`run` is the test command, and it runs in the step whose id is `test`.
`env` and `setup` are optional.

`ci.yml` holds each declared job after the other test jobs, in the order the setting lists them.
The job runs after `changes`, skips where the default test jobs skip, and `checks` requires it.
It checks out the pull request head, sets up Bun, and uploads `artifacts/`.
In a code repository, it also holds the draft pull request cancel step.

The check accepts exactly the declared jobs.
A job with a setup step or an `env` that the setting does not declare fails the check.
A hand edit to a declared job fails it too.
Each setup command and the test command go through the [checks-plain-steps](checks-plain-steps.md) policy, so each is one plain command.
`checks-workflows` refuses a command list such as `a && b`, a pipe, and a command named only at run time, such as `${{ matrix.install }}`.
It also refuses a name listed twice and a name `ci.yml` already gives a job.
Those names are `changes`, `static`, `site`, `docs`, `checks`, `unit`, `e2e` and `browser`.

## The composed ci.yml

`ci.yml` holds one job per concern:

| Job | Runs |
| --- | --- |
| `changes` | first, and tells whether the run checks the release pull request and whether the pull request changes only documentation |
| `static` | after `changes`, and checks the workflow files, lints, builds and typechecks |
| `site` | in a site, after `changes`, and builds the site, deploys the preview and uploads the build as `site-dist` |
| `docs` | when `package.json` defines `docs:build`, after `changes`, and runs that script |
| each test job | after `changes`, or after `site` when it reads the build, and runs its one command in the step whose id is `test` |
| `checks` | always, after every other job, and fails unless each one passed or skipped as allowed |

Branch protection reads the gate job as `checks`.
The `e2e` job installs the gitleaks binary the kit pins in the shared cache before it runs tests.
On a dispatched run, the `checks` job posts its result as the `checks` status and the title as the `commitlint` status.
On a pull request that changes only documentation, the `site` job and the test jobs skip, and the gate passes those skips.
Only two runs count as the release pull request.
One is the `workflow_dispatch` run on a `release/` branch, which [checks-release-pr](checks-release-pr.md) dispatches.
The other is the same repository pull request from `release/<base>` into `<base>`.
On those runs every job but `changes` and `checks` skips, unless the repository is a private root with a `test` script.
Then the static, docs, and test jobs run on the release pull request, and the gate does not accept their skips.
Its default test step runs `bunx checks-ci test` with `CHECK_RELEASE` set from the `check-release` output of `changes` and `TEST_TIER` set to its tier.
For each default tier, that step runs `bun run test --tier=<tier>` on the release pull request and `bunx checks-test --pr --tier=<tier>` on any other run.
For a sharded tier, the step also sets `TEST_SHARD` to `${{ matrix.shard }}/<count>`.
Without the release wrapper, the default test command instead appends `--shard=${{ matrix.shard }}/<count>`.
A fork pull request from a `release/` branch and a pull request from a `release/` branch that does not match `release/<base>` run every job.
Jobs that skip release runs read the `release` output of `changes`.
A private root with a `test` script also reads `check-release` to keep its checks running.

The test jobs `ci.yml` holds are the record of what the repository runs.
The `docs` job runs on every pull request the `static` job runs on, documentation-only ones included, and `checks` requires it to pass.
A job whose step with id `test` runs a command is a test job, unless `extraTestJobs` declares its name, which makes `checks.config.ts` its record.
It keeps its name, that command, the browsers its `playwright` step installs, and its `runs-on`.
A test job's `runs-on` can be a string or a non-empty list of label strings.
For example, a private repository can use `runs-on: [self-hosted, macOS, ARM64]` when `selfHostedRunners` lists that set of labels.
[checks-ci-wiring](checks-ci-wiring.md#runners) still judges which runners a job may use.
A single all-tier `test` or `unit` job using `bunx checks-test --pr` or `bun run test --pr` becomes separate tier jobs.
The split keeps a `--parallel` argument and moves the browser setup to `e2e`.
In a site, a test job that needs `site` reads the build.
`changes`, `static`, `site` in a site and `checks` are always there.
Every other line of the file is the shape the kit writes: the order of the jobs, `needs`, `if`, the pins and the permissions.
A `ci.yml` with a step that runs `bunx checks-ci secrets-pack` keeps that step in `static`, which unpacks the `CHECKS_SECRETS_PACK` secret before lint.

The generated `ci.yml` runs on pull requests, pushes to `main`, and manual dispatches.
On pushes to `main`, the default test jobs run their whole tiers and the browser walks every route.
If the pull request reaches no browser route, the browser job skips and the gate accepts the skip.
A change confined to TypeScript files under `tests/unit/` and `tests/e2e/`, including helpers, skips both the site build and its dependent jobs.
A `checks.config.ts` change confined to `reach` entries counts the same way, as [checks-ci](checks-ci.md) says.
Existing screenshot test jobs keep their commands, and the kit adds no default screenshot job.
A job that runs `bunx checks-test --pr-screens` narrows screenshot tests on pull requests and runs the whole pixel tier on other events.
A site production run runs the full browser walk and compares screenshots on the staged release commit.

Run `bunx checks-workflows --write` to write the workflow set.

A `ci.yml` with no test job gets the default jobs of its kind:

| Kind | Default test jobs |
| --- | --- |
| code | `unit` and, when `tests/e2e/` holds a test file, `e2e` |
| site | `unit`, `e2e` when present, and `browser`, which runs `bunx checks-browser --pr` on `webkit` against the `site-dist` build |

The default `unit` job runs `bunx checks-test --pr --tier=unit`.
The default `e2e` job runs `bunx checks-test --pr --tier=e2e`.
A private root with a `test` script uses the release wrapper described above instead.
The `checks` job requires both jobs when both exist.
Rulesets that require individual test jobs must require `unit` and, when present, `e2e`.
A ruleset requiring only the aggregate `checks` job needs no change.

Set `repositoryVisibility: "private"` in `checks.config.ts` for a private GitHub repository.
The setting defaults to `public` and is independent of the `private` field in `package.json`.
A public repository uses hosted runners without `CI_RUNS_ON` in `ci.yml`, `pr-title.yml`, `pr-text.yml`, `preview-close.yml` and `whole-tree-run.yml`.
Its other workflows keep `${{ vars.CI_RUNS_ON || 'ubuntu-latest' }}`.
A private repository uses `${{ vars.CI_RUNS_ON || 'ubuntu-latest' }}` for its default jobs.
The generated mutation workflow always uses hosted runners.
The default test runner follows the setting even when a previous `ci.yml` holds the other default.

To add a test job, copy the `unit` job of `ci.yml` under a new name, change the `run` of its step with id `test`, then run `checks-workflows --write`.
A test job that needs its own environment or setup steps goes in [`extraTestJobs`](#add-a-test-job-with-its-own-setup) instead.

## What it reads

It reads the `.yml` and `.yaml` files under `.github/workflows/`, the files under `.github/actions/`, and `checks.config.ts` from the repository root.
It also reads the root and workspace `package.json` files and checks for test files under `tests/e2e/` and `tests/pixel/`.

## Arguments

```sh
checks-workflows
checks-workflows --write
checks-workflows --write --pages acme --domain acme.example --production acme/acme.example
```

With `--write` it writes every file of the set and its actions, and rewrites a present optional file to the file the set writes.
It deletes every other workflow file except a private repository's `pr-text.yml`.
It writes `ci.yml` with the jobs the present `ci.yml` holds, in the shape the kit writes.
A rewrite of a site keeps the three names its workflows hold.
A job that calls `site-ci.yml`, `site-main.yml`, `site-production.yml`, `site-preview.yml` or `preview-remove.yml` passes the three names in `with`, and `--write` keeps them as the site names.
A job that calls the shared `test.yml` keeps its `run`, its `browsers` and its `runs-on`.
In a site, `artifact: site-dist` keeps the job on the `site` build, and any other `artifact` refuses the write.
The set replaces `hold`, `heavy` and `claude-version`, so `--write` drops them.
A caller input the set cannot carry refuses the write, and the message names the input.
`--pages`, `--domain` and `--production` name a site with no site workflow yet, and each replaces the name the workflows hold.
A site write with a missing name, two values of one, or an unparsable name writes nothing.
It names the fix.

## Exit codes

| Code | When |
| --- | --- |
| 0 | the workflow files are the set, or `--write` wrote it |
| 1 | `flakeCron` is set in a site, `extraTestJobs` takes a reserved job name or holds a setup or test command that is not plain, a file of the set is missing or differs, another workflow file appears, a job calls a workflow of another repository, the site workflows hold none, two values or an unparsable value of a name, a test job of `ci.yml` holds an unparsable input or a name a job cannot take, a caller passes an input the set cannot carry, or `checks.config.ts` sets `releaseAssets` or `platformPackages` in a site or a private repository, or `platformPackages` with a private `package.json` and no public workspace |
| 2 | `flakeCron` does not decode, `--write` meets `flakeCron` in a site, `extraTestJobs` does not decode, including a job name listed twice, `--write` meets a reserved extra job name or a setup or test command that is not plain, the arguments do not parse, a workflow file or `package.json` cannot be read, a site write lacks one of the three names, holds two values of one, or names one that does not parse, a test job of `ci.yml` holds an unparsable input or a name a job cannot take, a caller passes an input the set cannot carry, `checks.config.ts` sets `releaseAssets` or `platformPackages` and `package.json` defines no `release:assets` script, `checks.config.ts` sets `platformPackages` in the kit or with a private `package.json` and more than one public workspace, or `--write` meets `releaseAssets` or `platformPackages` in a site or a private repository, or `platformPackages` with a private `package.json` and no public workspace |

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
