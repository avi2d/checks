---
kind: reference
audience: consumers
---
# checks-production-gate

`checks-production-gate` refuses to publish a commit to production unless it is a published release.

## What it checks

It reads the version `package.json` holds at the commit and looks for the tag `v<version>` on `origin`.
It refuses the commit when that tag is missing or tags another commit.
It refuses when the tag holds no GitHub release, or only a draft or a prerelease.
It refuses when the release notes lack the `CHANGELOG.md` section for that version, as the commit holds the file.

A release passes without running a test.
[checks-release-tag](checks-release-tag.md) creates the GitHub release only after the landed tree matches the tree the required checks of its release pull request passed on.
Those checks passed on that tree, so a published release is a tree that passed them.
In a repository whose `ci.yml` is the one [checks-workflows](checks-workflows.md) composes, those checks skip every job, so the tag publishes code the pull requests into `main` tested, and the release commit adds only the version and the changelog.

## What it reads

It reads `package.json` and `CHANGELOG.md` at the commit with `git show`, so the checkout holds that commit.
It reads the tag from `origin` with `git ls-remote`.
It reads the release with `gh api`, which takes the repository from the checkout's remote and the token from `GH_TOKEN`.
The token needs `contents: read`.

## Arguments

```sh
checks-production-gate [<commit>]
```

The argument names the commit production would publish, such as the one staging serves.
Without it the gate judges `HEAD`.

## Exit codes

| Code | When |
| --- | --- |
| 0 | the commit is a published release |
| 1 | the commit is no published release |
| 2 | the arguments do not parse, the commit does not exist, the commit holds no `package.json` or no `CHANGELOG.md`, its `package.json` does not parse, `git ls-remote` to `origin` fails, or a GitHub API call fails |

## Sample output

```
production-gate: 3f2a9c81d0b4 is the release v0.4.0, so production publishes it without running the tests again
```

A refusal names what the commit lacks:

```
production-gate: production publishes only a published release, and 3f2a9c81d0b4 has no tag v0.4.0; merge its release pull request first
```

## When it runs

The one job of a site's `production.yml` runs it before the production build, so production runs no test of its own.

## Related topics

- [checks-release-tag](checks-release-tag.md)
- [checks-release-notes](checks-release-notes.md)
