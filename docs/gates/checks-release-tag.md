---
kind: reference
audience: consumers
---
# checks-release-tag

`checks-release-tag` releases a landed release commit.
With no argument it tags the commit, creates its GitHub release and publishes the package.
With a workflow argument it tags the commit and dispatches that workflow on the tag.

## What it checks

With a workflow argument it reads the subject of `HEAD`, and does nothing unless the subject is `chore: release <version>`, with or without the pull request number a squash merge appends.
It refuses a release commit whose `package.json` holds another version.
It tags that commit as `v<version>` and pushes the tag to `origin`.

### With no argument

It is the one release step a `main.yml` caller runs on each push to `main`.
When `HEAD` is no release commit, it walks the first parent history back to the newest release commit whose tag already tags it, or to the root.
It releases the newest untagged release commit found there with the same steps as for `HEAD`.
The walk stops with no release once the version `package.json` holds at `HEAD` is not the candidate's version, so a cancel commit ends it.
When the release commit sits behind `HEAD`, it checks out the release commit in the same checkout and installs its dependencies with `bun install --frozen-lockfile`, refusing when the checkout holds uncommitted changes.
It then runs the build check and the publish there, so npm ships the tree the required checks of the release pull request passed on.
A merge with no untagged release commit behind it ends at once, before any API call.
On a release commit it first fetches the head of the pull request the squash subject names, such as `(#7)`.
It refuses unless the tree of that commit equals the tree the required checks of that pull request passed on.
That check is what lets the release run pass without running a test.
It matches the tree the required checks of the release pull request passed on.
In a repository whose `ci.yml` is the one [checks-workflows](checks-workflows.md) composes, those checks skip every job, so the tag publishes code the pull requests into `main` tested, and the release commit adds only the version and the changelog.
It then pushes the tag and creates the GitHub release `v<version>`, whose notes are the `CHANGELOG.md` section for that version.
It publishes the package to npm as [checks-release-publish](checks-release-publish.md) says, unless `package.json` holds `"private": true`.
The changelog is built once, by the release pull request, and this run reads the committed file.
When `HEAD` is the release commit, a rerun finds the tag, rewrites the release notes in place, and finds the version on npm, so it neither tags, releases nor publishes twice.
A release whose GitHub release or npm publish failed is finished by rerunning that release commit's own `main` run.

### With a workflow argument

A tag the workflow token pushes starts no `push` workflow, so it then dispatches the workflow its argument names on the tag.
It does nothing when `v<version>` already tags `HEAD`, so a rerun after a release never publishes it twice.
When the dispatch fails after the push, it names `gh workflow run <workflow> --ref v<version>`.
A rerun then finds the tag and does nothing, so that command is what dispatches the release workflow by hand.
It refuses when `v<version>` already tags another commit.
Before it pushes the tag, it runs `bun run build` and refuses when the build rewrites a committed file.
That happens when a release pull request merged behind `main`, so its `CHANGELOG.md` lacks the commits `main` gained.
The refusal says to open a `chore: cancel the unpublished <version>` pull request that returns `package.json` to the last tag's version and commits what `bun run build` then writes to `CHANGELOG.md`.
The build reads the returned version as a revert, so it drops the unpublished section.
The next run of the workflow that tags it then cuts the release again with every change since the last tag.

## What it reads

It reads the subject of `HEAD` and of each commit behind it, `package.json` at each of those commits and `CHANGELOG.md` at the release commit, and the tag from `origin` with `git ls-remote`.
With a workflow argument it names the workflow it runs in by `GITHUB_WORKFLOW`, or as `release-pr` when that is unset.
With no argument it names `release`.
The build it runs reads the whole history, so the checkout fetches all of it.
It pushes the tag with the credentials the checkout holds.
It calls the GitHub API through `gh api`, which takes the repository from the checkout's remote and the token from `GH_TOKEN`.
With a workflow argument the token needs `contents: write` and `actions: write`.
With no argument it needs `contents: write`, and publishing needs the npm credentials [checks-release-publish](checks-release-publish.md) names.

## Arguments

```sh
checks-release-tag
checks-release-tag <workflow>
```

With no argument it releases the commit itself.
The argument names the release workflow file under `.github/workflows/`, such as `release.yml`.
That workflow triggers on `workflow_dispatch` and keeps its own guards, as [checks-release-notes](checks-release-notes.md) shows.

## Exit codes

| Code | When |
| --- | --- |
| 0 | `HEAD` is no release commit, its tag already tags it, the tag is pushed and the release workflow dispatched, or the release is tagged, released on GitHub and published |
| 2 | the arguments do not parse, `package.json` disagrees with the subject, the tree differs from the one the release pull request tested, the publish fails, the tag tags another commit, the build or the install fails, the build rewrites a committed file, the checkout holds uncommitted changes, or the push or a GitHub API call fails |

## Sample output

A run with no argument on a release commit prints:

```
release-tag: 3f2a9c81d0b4 matches the tree pull request #7 tested
release-tag: tagged 3f2a9c81d0b4 as v0.4.0
release-tag: created the GitHub release v0.4.0 with the CHANGELOG.md section for 0.4.0
release-publish: published @acme/widget@0.4.0
```

A run with a workflow argument prints the build's own output, then one line:

```
release-tag: tagged 3f2a9c81d0b4 as v0.4.0, and dispatched release.yml on it
```

## When it runs

With no argument, the one job of a repository's `main.yml` runs it on each push to `main`, in the caller set `checks-workflows` writes.
With a workflow argument, the `tag` job of the `release-pr` workflow runs it on each push to `main` whose head commit reads as a release, as [checks-release-pr](checks-release-pr.md#running-it-in-ci) shows.

## Related topics

- [checks-release-pr](checks-release-pr.md)
- [checks-release-notes](checks-release-notes.md)
- [checks-release-publish](checks-release-publish.md)
