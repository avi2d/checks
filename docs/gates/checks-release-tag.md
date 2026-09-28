---
kind: reference
audience: consumers
---
# checks-release-tag

`checks-release-tag` tags a landed release commit with its version and dispatches the release workflow on the tag.

## What it checks

It reads the subject of `HEAD`, and does nothing unless the subject is `chore: release <version>`, with or without the ` (#N)` a squash merge adds.
It refuses a release commit whose `package.json` holds another version.
It tags `HEAD` as `v<version>` and pushes the tag to `origin`.
A tag the workflow token pushes starts no `push` workflow, so it then dispatches the workflow its argument names on the tag.
It does nothing when `v<version>` already tags `HEAD`, so a rerun after a release never publishes it twice.
When the dispatch fails after the push, it names `gh workflow run <workflow> --ref v<version>`.
A rerun then finds the tag and does nothing, so that command is what dispatches the release workflow by hand.
It refuses when `v<version>` already tags another commit.

## What it reads

It reads the subject of `HEAD` and `package.json` from the checkout, and the tag from `origin` with `git ls-remote`.
It pushes the tag with the credentials the checkout holds.
It calls the GitHub API through `gh api`, which takes the repository from the checkout's remote and the token from `GH_TOKEN`.
The token needs `contents: write` and `actions: write`.

## Arguments

```sh
checks-release-tag <workflow>
```

The argument names the release workflow file under `.github/workflows/`, such as `release.yml`.
That workflow triggers on `workflow_dispatch` and keeps its own guards, as [checks-release-notes](checks-release-notes.md) shows.

## Exit codes

| Code | When |
| --- | --- |
| 0 | `HEAD` is no release commit, its tag already tags it, or the tag is pushed and the release workflow dispatched |
| 2 | the arguments do not parse, `package.json` disagrees with the subject, the tag tags another commit, or the push or a GitHub API call fails |

## Sample output

```
release-tag: tagged 3f2a9c81d0b4 as v0.4.0, and dispatched release.yml on it
```

## When it runs

The `tag` job of the daily release workflow runs it on each push to `main` whose head commit reads as a release, as [checks-release-pr](checks-release-pr.md#running-it-in-ci) shows.

## Related topics

- [checks-release-pr](checks-release-pr.md)
- [checks-release-notes](checks-release-notes.md)
