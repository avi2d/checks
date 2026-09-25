# The commit message lint

The shared commitlint config holds each pull request title to conventional commits, and a reader looks it up to wire the lint into a repository's CI.

## Config

Commits follow `@commitlint/config-conventional` plus the house prefixes `commitlint.config.js` lists, shared from `@avi2dg/checks/commitlint.config.js`.
It arrives with the kit, since `@commitlint/cli` and `@commitlint/config-conventional` are dependencies, not peers.

## Workflow

The lint runs in CI on pull requests, because `jj` never fires a git hook.
The kit writes this workflow whole when `checks-quality generate` runs:

```yaml
on:
  pull_request:
    types: [opened, edited, synchronize, reopened]
jobs:
  commitlint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      # Only the title is linted: it is what a squash merge lands, with GitHub appending " (#N)" to it.
      - run: printf '%s' "$PR_TITLE (#0000)" > "$RUNNER_TEMP/pr-title"
        env:
          PR_TITLE: ${{ github.event.pull_request.title }}
      - run: ./node_modules/.bin/commitlint --config ./node_modules/@avi2dg/checks/commitlint.config.js --edit "$RUNNER_TEMP/pr-title"
```

## What it lints

It lints the pull request title and nothing else.
The title is the enforced subject because a squash merge uses it as the main commit subject, and per-commit messages are not linted.
GitHub appends ` (#N)` to the squashed subject, so the workflow lints the title with that suffix attached, and the header length limit applies to the landed subject, not the bare title.

It never sees a commit's author or committer fields, nor the `Co-authored-by` trailer GitHub writes from a foreign author when it squashes, so it cannot enforce who a commit belongs to.
[checks-commit-identity](../gates/checks-commit-identity.md) is that enforcement.

## Related topics

- [checks-commit-identity](../gates/checks-commit-identity.md)
