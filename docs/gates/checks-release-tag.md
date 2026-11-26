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
It refuses before tagging when the release commit lacks `CHANGELOG.md` at the repository root.
It tags that commit as `v<version>` and pushes the tag to `origin`.

### With no argument

It is the one release step the `main.yml` [checks-setup](checks-setup.md) writes runs on each push to `main`.
When `HEAD` is no release commit, it walks the first parent history back to the newest release commit whose tag already tags it, or to the root.
It releases the newest untagged release commit found there with the same steps as for `HEAD`.
The walk stops with no release once the version `package.json` holds at `HEAD` is not the candidate's version, so a cancel commit ends it.
When the release commit sits behind `HEAD`, it checks out the release commit in the same checkout and installs its dependencies with `bun install --frozen-lockfile`, refusing when the checkout holds uncommitted changes.
It then runs the build check and the publish there, so npm ships the tree the required checks of the release pull request passed on.
A merge with no untagged release commit behind it ends at once, without pushing a tag or creating a release.
On a release commit it first fetches the head of the pull request the squash subject names, such as `(#7)`.
It refuses unless the tree of that commit equals the tree the required checks of that pull request passed on.
That check is what lets the release publish a tested tree even though a release pull request without release checks runs no test.
It matches the tree the required checks of the release pull request passed on.
In a repository whose `ci.yml` is the one [checks-workflows](checks-workflows.md) composes, release checks run in a private root with a `test` script.
Elsewhere, those checks skip every job but `changes`.
It then pushes the tag and creates the GitHub release `v<version>`, whose notes are the `CHANGELOG.md` section for that version.
When `GITHUB_OUTPUT` is set, it then writes the tag as the step output `tag`.
The `assets` job that [Attach release assets](checks-workflows.md#attach-release-assets) describes reads that output.
It runs `bun run build` before publishing, including when the tag already points at the release commit.
It publishes the package to npm as [checks-release-publish](checks-release-publish.md) says, unless `package.json` holds `"private": true`.
When `checks.config.ts` sets `platformPackages`, it first stages and publishes one package per platform from the binaries in the directory `CHECKS_PLATFORM_BINARIES` names, as [Publish platform packages](checks-workflows.md#publish-platform-packages) says.
It then adds those packages to `optionalDependencies` in the main package's `package.json` before it publishes the main package.
It refuses before it tags anything when `CHECKS_PLATFORM_BINARIES` is unset or a platform's binary is missing.
When the root is private and `CHECKS_PUBLISH_WORKSPACES` is `true`, it publishes each public workspace package instead.
With `platformPackages` the private root must publish exactly one workspace, and that workspace, such as `packages/run/package.json`, is the main package.
Each public workspace version must equal the root release version before it tags anything.
The release pull request sets those versions before its checks run.
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

It reads the subject of `HEAD` and of each commit behind it, `package.json` at each of those commits and `CHANGELOG.md` at the release commit.
It reads the tag through the GitHub API.
When workspace publishing is enabled, it reads the workspace patterns and each workspace `package.json`.
It reads `platformPackages` from `checks.config.ts` and the binaries in the directory `CHECKS_PLATFORM_BINARIES` names.
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
| 2 | the arguments do not parse, the release commit lacks `CHANGELOG.md`, `package.json` disagrees with the subject, the tree differs from the one the release pull request tested, the publish fails, the tag tags another commit, the build or the install fails, the build rewrites a committed file, the checkout holds uncommitted changes, `checks.config.ts` sets `platformPackages` and `CHECKS_PLATFORM_BINARIES` is unset, a platform's binary is missing or a private root publishes no workspace or more than one, or the push or a GitHub API call fails |

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

With no argument, the `release` job of the `main.yml` `checks-workflows` writes runs it on each push to `main`.
With a workflow argument, the `tag` job of the `release-pr` workflow runs it on each push to `main` whose head commit reads as a release, as [checks-release-pr](checks-release-pr.md#running-it-in-ci) shows.

## Related topics

- [checks-release-pr](checks-release-pr.md)
- [checks-release-notes](checks-release-notes.md)
- [checks-release-publish](checks-release-publish.md)
