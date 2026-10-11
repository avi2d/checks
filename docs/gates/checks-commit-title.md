---
kind: reference
audience: consumers
---
# checks-commit-title

`checks-commit-title` lints the pull request title against the shared commitlint config in one step of the `ci` job.

## What it checks

It lints the pull request title and nothing else.
The title comes from `PR_TITLE` when the event carries one.
A dispatched run carries no pull request, so the bin reads the title of the one open pull request its branch heads, and fails when there is none.
A run with no title to lint passes and says so.
The bin lints the title with ` (#0000)` attached, since GitHub appends the pull request number to the squashed subject.
It moves the git comment character off `#`, so a title starting with `#` is linted like any other.

## What it reads

It reads `PR_TITLE` and `GITHUB_EVENT_NAME` from the environment.
A dispatched run also reads `GITHUB_REPOSITORY`, `GITHUB_REPOSITORY_OWNER` and `GITHUB_REF_NAME`, and calls `gh api` with `GH_TOKEN` for the open pull request.
It lints with the installed kit's commitlint config through the installed commitlint cli, as [The commit message lint](../configs/commit-messages.md) says.

## Arguments

The bin takes no arguments.

## Exit codes

| Code | Result |
| --- | --- |
| 0 | The title lints clean, or there is no title to lint. |
| 1 | The title breaks the rules, or no one open pull request heads the branch. |
| 2 | The kit config or binary cannot be resolved, or a dispatched run misses its environment. |

## Sample output

```
⧗   --- input ---
# feat(lint): add x (#0000)
✖   subject may not be empty [subject-empty]
✖   type may not be empty [type-empty]

✖   found 2 problems, 0 warnings
ⓘ   Get help: https://github.com/conventional-changelog/commitlint/#what-is-commitlint
```

## When it runs

The `ci` job runs it on `pull_request` and `workflow_dispatch`, as [checks-ci-wiring](checks-ci-wiring.md) requires.
The job then posts its outcome as a `commitlint` status, as [The commit message lint](../configs/commit-messages.md) says.

## Related topics

- [The commit message lint](../configs/commit-messages.md)
- [checks-ci-wiring](checks-ci-wiring.md)
