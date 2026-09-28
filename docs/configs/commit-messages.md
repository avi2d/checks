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
Each repository owns `.github/workflows/commitlint.yml` and runs the installed `commitlint` binary in a pull request step.
The workflow lints with the installed kit's `commitlint.config.js`, so every repository holds titles to the same rules.

## What it lints

It lints the pull request title and nothing else.
The title is the enforced subject because a squash merge uses it as the main commit subject, and per-commit messages are not linted.
GitHub appends ` (#N)` to the squashed subject, so the workflow lints the title with that suffix attached, and the header length limit applies to the landed subject, not the bare title.
The workflow moves git's comment character off `#`, so a title starting with `#` is linted like any other.
The workflow also triggers on `workflow_dispatch`, since a release pull request the workflow token opens starts no `pull_request` run, as [checks-release-pr](../gates/checks-release-pr.md) says.
A dispatched run carries no pull request, so the workflow reads the title of the one open pull request its branch heads, and fails when there is none.
The kit's own `.github/workflows/commitlint.yml` shows the step.

It never sees a commit's author or committer fields, nor the `Co-authored-by` trailer GitHub writes from a foreign author when it squashes, so it cannot enforce who a commit belongs to.
[checks-commit-identity](../gates/checks-commit-identity.md) is that enforcement.

## Related topics

- [checks-commit-identity](../gates/checks-commit-identity.md)
