---
kind: reference
audience: consumers
---
# checks-release-push

`checks-release-push` lands the next version of a package on its branch once the checks pass.
It then tags the release and dispatches the release workflow on the tag.

## What it checks

It lists the unreleased changes the way [checks-release-report](checks-release-report.md) does, and does nothing when there are none.
It bumps the version `package.json` holds by the rule [checks-release-pr](checks-release-pr.md#what-it-checks) states, and refuses what that bin refuses.
It refuses when `v<version>` of the next version already tags a commit, since a version is released once.
It writes the next version into `package.json` and runs `bun run build`, which writes `CHANGELOG.md`.
It commits both as `chore: release <version>` on top of `HEAD` through the GitHub API, as `checks-release-pr` does.
It points the branch `release/<branch>` at that commit and dispatches every check workflow its arguments name there.
It waits up to 45 minutes in all for those workflows to finish on the release commit.
It reads the newest run of each, so a rerun stands in for the run it repeats.
A failed read of the runs list does not end the wait.
The wait retries the read at the same interval.
A successful read resets the count of failed reads in a row.
Past four failed reads in a row the run fails with the last read error.
When any of them concludes short of success, it refuses and leaves `<branch>` and the tags alone.
When all of them pass, it moves `<branch>` to the release commit without a force.
GitHub refuses that update when `<branch>` moved while the checks ran.
The run then ends cleanly, since the run of the push that moved it releases the new head.
When the update fails but `<branch>` already holds the release commit, the update landed and the run goes on.
It then tags the release commit `v<version>`, pushes the tag and dispatches the release workflow on it, and waits up to 45 minutes for that workflow's run on the release commit to finish.
When that run concludes short of success, or does not finish in time, the bin fails, though `<branch>` already holds the release and the tag exists.
When `HEAD` is itself a release commit, it tags it as [checks-release-tag](checks-release-tag.md) does, and waits for the release workflow it dispatches the same way.
So a rerun after a failed tag push finishes the release.
It leaves the working tree as it found it.

No pull request is opened, so a package release needs neither a merge by hand nor the setting that lets the token open pull requests.

## What it reads

It reads the `v*` tags, the commit subjects since the last one and `package.json` from the checkout.
It refuses a shallow checkout, a detached `HEAD` and a working tree with changes to tracked files.
It reads the tags and the branch from `origin` with `git ls-remote`, and pushes the tag with the credentials the checkout holds.
It calls the GitHub API through `gh api`, which takes the repository from the checkout's remote and the token from `GH_TOKEN`.
The token needs `contents: write` and `actions: write`.
The branch's protection must let the workflow token push a commit whose required checks passed, so it requires status checks and no pull request review.

## Arguments

```sh
checks-release-push <release-workflow> <workflow>...
```

The first argument names the release workflow file under `.github/workflows/`, such as `release.yml`, which triggers on `workflow_dispatch` and keeps its own guards, as [checks-release-notes](checks-release-notes.md) shows.
Each later argument names a workflow file whose jobs report the checks the branch requires, such as `ci.yml`.
Each named workflow triggers on `workflow_dispatch`.
Name no check workflow that runs something else on dispatch, such as a mutation baseline.

## Exit codes

| Code | When |
| --- | --- |
| 0 | nothing is unreleased, the branch moved while the checks ran, the release tag already tags `HEAD`, or the release landed and its release workflow finished |
| 2 | the arguments do not parse, a refusal above applies, a check fails or does not finish in time, the build fails, the push or a GitHub API call fails, or the dispatched release workflow fails or does not finish in time |

## Sample output

A run that releases prints the build's own output, then three lines:

```
release-push: dispatched ci.yml on release/main to check 0.4.0 at 3f2a9c81d0b4
release-push: released 0.4.0 as 3f2a9c81d0b4 on main, tagged it v0.4.0, and dispatched release.yml on it
release-push: release.yml finished on v0.4.0
```

A run whose release workflow fails refuses with the run that failed, though the branch already holds the release and the tag exists:

```
checks-release-push: the release workflow failed on 3f2a9c81d0b4: release.yml concluded failure at https://github.com/acme/widget/actions/runs/7
```

A run whose checks fail refuses with the run that failed:

```
checks-release-push: the checks failed on 3f2a9c81d0b4, so the release stays off the branch: ci.yml concluded failure at https://github.com/acme/widget/actions/runs/7
```

## When it runs

A package published to npm runs it on every push to `main`, so each merged feature or fix ships as a versioned release.
Run the workflow by hand with `gh workflow run release-push` to cut a release now.

## Running it in CI

A package repository takes it as `.github/workflows/release-push.yml`:

```yaml
name: release-push
on:
  workflow_dispatch:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  release:
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    timeout-minutes: 120
    concurrency:
      group: release-push
      cancel-in-progress: false
    permissions:
      contents: write
      actions: write
    steps:
      - uses: actions/checkout@v5
        with:
          ref: ${{ github.ref }}
          fetch-depth: 0
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version-file: .bun-version
      - run: bun install --frozen-lockfile
      - name: release what main holds once its checks pass
        env:
          GH_TOKEN: ${{ github.token }}
        run: ./node_modules/.bin/checks-release-push release.yml ci.yml
```

The push the workflow token makes starts no run, so landing the release commit never starts the workflow again.
The concurrency group holds from reading the branch until the release workflow it dispatched finishes, so releases cut by release-push publish one at a time, and a queued run the group cancels had cut nothing.
That hold ends early in two cases.
One is when the 45 minute wait times out.
The other is when polling fails past the retry bound or the dispatch of the release workflow fails after GitHub accepted it.
In those cases an unfinished publisher can overlap the next release, and if `latest` lands on the older version, `npm dist-tag add <package>@<newer version> latest` repairs it.
[checks-release-publish](checks-release-publish.md) stays the guard for a release workflow dispatched or rerun by hand.
A run that waits behind it checks out the branch's tip when it starts, so it releases on top of what landed.
The job waits on the checks it dispatched and on the release workflow, so a hosted runner bills the minutes those workflows take.
A private repository sets `runs-on: ${{ vars.CI_RUNS_ON || 'ubuntu-latest' }}`, as [checks-ci-wiring](checks-ci-wiring.md#runners) requires of every job but a mutation job.

The other workflows accept the dispatch the way [checks-release-pr](checks-release-pr.md#running-it-in-ci) lists:

- `.github/workflows/ci.yml` triggers on `workflow_dispatch` and grants `statuses: write` and `pull-requests: read`.
- Each required job ends with the step that reports its result as a commit status.
- The title lint lints the subject of the head commit when no open pull request heads the dispatched branch, as [Commit messages](../configs/commit-messages.md) says.
- `.github/workflows/release.yml` triggers on `workflow_dispatch` and refuses a ref that is not a tag.

## Related topics

- [checks-release-report](checks-release-report.md)
- [checks-release-pr](checks-release-pr.md)
- [checks-release-tag](checks-release-tag.md)
- [checks-release-notes](checks-release-notes.md)
- [checks-release-publish](checks-release-publish.md)
