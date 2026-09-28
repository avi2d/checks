---
kind: reference
audience: consumers
---
# checks-release-pr

`checks-release-pr` opens or refreshes the one pull request that releases the next version, and dispatches its checks on its head.

## What it checks

It lists the unreleased changes the way [checks-release-report](checks-release-report.md) does, and does nothing when there are none.
It bumps the version `package.json` holds by the kit's rule:

| Unreleased changes | Below 1.0.0 | From 1.0.0 |
| --- | --- | --- |
| a breaking change | minor | major |
| a feature and no breaking change | minor | minor |
| only fixes, performance changes or reverts | patch | patch |

It refuses when the last release tag names a version other than the one `package.json` holds, since an untagged bump means a release landed that nothing published.
The refusal points at the `tag` job of `daily-release` on the release commit, whose own refusal says what to fix, rather than at a tag pushed by hand.
It refuses a version that is not a plain `major.minor.patch`.
It writes the next version into `package.json`, runs `bun run build` so the build writes `CHANGELOG.md`, and commits every tracked file the build changed as `chore: release <version>`.
The commit's one parent is `HEAD`.
It makes the commit through the GitHub API, which attributes it to `github-actions[bot]` and signs it, so the job sets no git identity.
It checks that the tree GitHub built matches the tree the build wrote.
It points the branch `release/<branch>` at the commit, where `<branch>` is the branch `HEAD` is on.
It opens a pull request from that branch into `<branch>` titled `chore: release <version>`, with the body `Release <version>.`, or retitles the open one to the new version.
It then dispatches each workflow its arguments name on the release branch.
GitHub holds the `pull_request` runs of a pull request the workflow token opens until a maintainer approves them, so the dispatch is what runs the required checks on the release head.
GitHub keeps a dispatched run's checks off the pull request, so each dispatched job reports its result as a commit status named for the job, which the required check of that name counts.
When the release branch already holds this version on top of `HEAD` and its pull request carries the right title, it pushes nothing and dispatches nothing.
It leaves the working tree as it found it.

## What it reads

It reads the `v*` tags, the commit subjects since the last one and `package.json` from the checkout.
It refuses a shallow checkout, a detached `HEAD` and a working tree with changes to tracked files.
It reads the release branch from `origin` with `git ls-remote` and `git fetch`.
It calls the GitHub API through `gh api`, which takes the repository from the checkout's remote and the token from `GH_TOKEN`.
The token needs `contents: write`, `pull-requests: write` and `actions: write`.
The repository needs **Allow GitHub Actions to create and approve pull requests** turned on under its Actions settings, or GitHub refuses the pull request.

## Arguments

```sh
checks-release-pr <workflow>...
```

Each argument names a workflow file under `.github/workflows/` whose jobs report the checks the default branch requires, such as `ci.yml` and `commitlint.yml`.
Each named workflow triggers on `workflow_dispatch`.
Name no workflow that runs something else on dispatch, such as a mutation baseline.

## Exit codes

| Code | When |
| --- | --- |
| 0 | nothing is unreleased, or the release pull request is open on the current `HEAD` and its checks are dispatched |
| 2 | the arguments do not parse, a refusal above applies, the build fails, or a GitHub API call fails |

## Sample output

A run that opens the pull request prints the build's own output, then one line:

```
release-pr: opened https://github.com/acme/widget/pull/12 to release 0.4.0, and dispatched ci.yml, commitlint.yml on release/main
```

A run on the same `HEAD` the next day prints one line:

```
release-pr: https://github.com/acme/widget/pull/12 releases 0.4.0 from 3f2a9c81d0b4 and is current
```

## When it runs

The daily release workflow below runs it once a day on the default branch.
Run the workflow by hand with `gh workflow run daily-release` to refresh the release pull request sooner.

## Running it in CI

A repository takes the daily release as `.github/workflows/daily-release.yml`.
The `pull-request` job runs on the schedule, and the `tag` job runs when a release commit lands on `main`, as [checks-release-tag](checks-release-tag.md) says:

```yaml
name: daily-release
on:
  schedule:
    - cron: "29 3 * * *"
  workflow_dispatch:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  pull-request:
    if: github.event_name != 'push'
    runs-on: ubuntu-latest
    timeout-minutes: 10
    concurrency:
      group: release-pull-request
      cancel-in-progress: false
    permissions:
      contents: write
      pull-requests: write
      actions: write
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version-file: .bun-version
      - run: bun install --frozen-lockfile
      - name: open or refresh the release pull request
        env:
          GH_TOKEN: ${{ github.token }}
        run: ./node_modules/.bin/checks-release-pr ci.yml commitlint.yml
  tag:
    if: "github.event_name == 'push' && startsWith(github.event.head_commit.message, 'chore: release ')"
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      contents: write
      actions: write
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version-file: .bun-version
      - run: bun install --frozen-lockfile
      - name: tag the release
        env:
          GH_TOKEN: ${{ github.token }}
        run: ./node_modules/.bin/checks-release-tag release.yml
```

A public repository keeps `runs-on: ubuntu-latest`.
A private repository sets `runs-on: ${{ vars.CI_RUNS_ON || fromJSON('["self-hosted","Linux","X64","winbox"]') }}` on both jobs, as its other workflows do.
A repository whose build needs more than Bun adds the steps its `.github/workflows/ci.yml` runs before `bun run build` to both jobs, and nothing after it.
Neither job runs a test suite or a mutation run.
On a hosted runner the `pull-request` job takes about 25 seconds, which GitHub bills as one minute, whether it opens, refreshes or leaves the pull request alone.
A private repository runs it on its self-hosted runner, which bills no minutes.
The `tag` job runs only when a release lands, and a job its `if` skips bills nothing.
The checks it dispatches are the release pull request's own required checks, and they run again only when `main` moves under it.
The pull request also lists its own `pull_request` runs as waiting for approval.
Nothing requires them, and approving them runs the same checks again.

The daily release needs the repository's other workflows to accept the dispatch:

- `.github/workflows/ci.yml` and `.github/workflows/commitlint.yml` trigger on `workflow_dispatch`, grant `statuses: write`, and end each required job with the step below.
  `commitlint.yml` also grants `pull-requests: read`, which the title lookup needs.
- The title lint reads the title of the one open pull request its branch heads when the event carries none, as [Commit messages](../configs/commit-messages.md) says.
- `.github/workflows/release.yml` triggers on `workflow_dispatch` and refuses a ref that is not a tag, as [checks-release-notes](checks-release-notes.md) shows.
- **Allow GitHub Actions to create and approve pull requests** is on, which the call after the step sets.
- A release pull request holds current `main` when it merges.
  One that merges behind `main` lands a changelog short of the commits `main` gained, and `checks-release-tag` refuses to tag it.

The step reports a dispatched run's result as a commit status on the head commit:

```yaml
      - name: report the result on the head commit
        if: always() && github.event_name == 'workflow_dispatch'
        env:
          GH_TOKEN: ${{ github.token }}
          STATE: ${{ job.status == 'success' && 'success' || 'failure' }}
        run: gh api "repos/$GITHUB_REPOSITORY/statuses/$GITHUB_SHA" -f state="$STATE" -f context="$GITHUB_JOB" -f target_url="$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID" --silent
```

The status takes the job's id as its name, so a required job's id is the check name the branch requires.
Where a status and a check share a name, branch protection requires both, so the status never passes a pull request whose own check failed.
The call turns the repository setting on:

```sh
gh api --method PUT repos/<owner>/<repo>/actions/permissions/workflow -F can_approve_pull_request_reviews=true
```

## Related topics

- [checks-release-report](checks-release-report.md)
- [checks-release-tag](checks-release-tag.md)
- [checks-changelog](checks-changelog.md)
- [checks-release-notes](checks-release-notes.md)
