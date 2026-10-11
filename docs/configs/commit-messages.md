---
kind: reference
audience: consumers
---
# The commit message lint

The shared commitlint config holds each pull request title to the conventional commit format.

## Config

Commits follow `@commitlint/config-conventional` plus the house prefixes `commitlint.config.js` lists, shared from `node_modules/@avi2dg/checks/commitlint.config.js`.
It arrives with the kit, since `@commitlint/cli` and `@commitlint/config-conventional` are dependencies, not peers.

## Workflow

The lint runs in CI on pull requests, because `jj` never fires a git hook.
Each repository lints the title in one step of its `ci` job with `bunx checks-commit-title`.
The workflow lints with the installed kit's `commitlint.config.js`, so every repository holds titles to the same rules.
The title lint runs before the docs-only filter, so a change to top-level Markdown and `docs/` Markdown alone still lints its title.

## What it lints

It lints the pull request title and nothing else.
The title is the enforced subject because a squash merge uses it as the main commit subject, and per-commit messages are not linted.
GitHub appends the pull request number to the squashed subject, so the bin lints the title with ` (#0000)` attached.
The header length limit applies to the landed subject, not the bare title.
The bin moves the git comment character off `#`, so a title starting with `#` is linted like any other.
The `ci` job also triggers on `workflow_dispatch`, since GitHub holds the `pull_request` runs of a release pull request the workflow token opens until a maintainer approves them, as [checks-release-pr](../gates/checks-release-pr.md) says.
A dispatched run carries no pull request, so the bin reads the title of the one open pull request its branch heads, and fails when there is none.
That lookup needs the workflow's `pull-requests: read` permission.
It reports a dispatched run's result on the head commit through the job's own status, since GitHub keeps a dispatched run's check off the pull request.
The kit's own `.github/workflows/ci.yml` shows the step.

It never sees a commit's author or committer fields, nor the `Co-authored-by` trailer GitHub writes from a foreign author when it squashes, so it cannot enforce who a commit belongs to.
[checks-commit-identity](../gates/checks-commit-identity.md) is that enforcement.

## Related topics

- [checks-commit-identity](../gates/checks-commit-identity.md)
