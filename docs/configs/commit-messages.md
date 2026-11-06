---
kind: reference
audience: consumers
---
# The commit message lint

The shared commitlint config holds each pull request title to the conventional commit format.

## Config

Commits follow `@commitlint/config-conventional`, shared from `node_modules/@avi2dg/checks/commitlint.config.ts`.
It arrives with the kit, since `@commitlint/cli` and `@commitlint/config-conventional` are dependencies, not peers.

A Dependabot title can capitalise `Bump` or `Update` after its prefix, which subject-case forbids.
So the config skips every rule for a one-line title in one of the shapes Dependabot writes, whoever wrote it:

- `build(deps)` or `build(deps-dev)`, then `Bump` or `bump`, then `X from A to B` with an optional `in /dir`, or `X and Y`, or `X, Y and Z`, or `X across N directories` with two or more, or `X in /dir`.
- `build(deps)` or `build(deps-dev)`, then `Bump` or `bump`, then `the G group`, optionally `in /dir` or `across N directory or directories`, then `with N update` or `with N updates`.
- `build(deps)` or `build(deps-dev)`, then `Bump` or `bump`, then `X from A to B in the G group`, optionally `across N directory or directories`.
- `build(deps)` or `build(deps-dev)`, then `Bump` or `bump`, then `X to V`, when the previous version is unknown.
- `build(deps)` or `build(deps-dev)`, then `Update` or `update`, then `X requirement`, then `from A` when the old requirement is known, then `to B`.
  A requirement may carry an operator such as `~> 1.4.0`, and several may be listed with commas, such as `^0.20, ^0.21`.

The title may end with the pull request number, such as ` (#123)`.
A body keeps every rule.
Every rule applies to any other title, including a hand-written title that uses a Dependabot prefix and verb but none of these shapes.
`chore` is not in the list because no avi2d repository's Dependabot config writes it.

## Workflow

The lint runs in CI on pull requests, because `jj` never fires a git hook.
Each repository lints the title in one step of its `ci` job with `bunx checks-commit-title`.
The workflow lints with the installed kit's `commitlint.config.ts`, so every repository holds titles to the same rules.
The `ci` job reports the title step's outcome as a `commitlint` status on every run, so a required `commitlint` status stays while `commitlint.yml` goes away.
That post needs the workflow's `statuses: write` permission.
The title lint runs before the docs-only filter, so a change to top-level Markdown and `docs/` Markdown alone still lints its title.

## What it lints

It lints the pull request title, or the head subject when no open pull request heads the dispatched branch.
The title is the enforced subject because a squash merge uses it as the main commit subject, and otherwise per-commit messages are not linted.
GitHub appends the pull request number to the squashed subject, so the bin lints the title with ` (#0000)` attached.
The header length limit applies to the landed subject, not the bare title, for any title the config does not skip.
The bin moves the git comment character off `#`, so a title starting with `#` is linted like any other.
The `ci` job also triggers on `workflow_dispatch`, as [checks-release-pr](../gates/checks-release-pr.md) and [checks-release-push](../gates/checks-release-push.md) say.
GitHub holds the `pull_request` runs of a release pull request the workflow token opens until a maintainer approves them.
A dispatched run carries no pull request, so the bin reads the title of the one open pull request its branch heads.
When no open pull request heads the branch, the head commit lands as it is, so the bin lints its subject as it stands.
It fails when more than one does.
That lookup needs the workflow's `pull-requests: read` permission.
The `commitlint` status covers a dispatched run too, since GitHub keeps a dispatched run's check off the pull request.
The kit's own `.github/workflows/ci.yml` shows the step.

It never sees a commit's author or committer fields, nor the `Co-authored-by` trailer GitHub writes from a foreign author when it squashes, so it cannot enforce who a commit belongs to.
[checks-commit-identity](../gates/checks-commit-identity.md) is that enforcement.

## Related topics

- [checks-commit-identity](../gates/checks-commit-identity.md)
