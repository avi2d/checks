---
kind: reference
audience: consumers
---
# checks-changelog

`checks-changelog` writes the pending release into `CHANGELOG.md` from the conventional commits since the last release.

## What it checks

It reads the version from `package.json` and treats that version as the release being prepared.
It lists every conventional commit the release closes, grouped as Features, Fixes, Performance, Reverts and Breaking changes.
It links each entry to its pull request under the repository address `package.json` names.
It keeps the date a released section already carries and dates a new section today.
It writes the whole file newest first, so the changelog is never edited by hand.
A repository with no tag yet releases from its first commit.
A release with no conventional commit worth listing keeps only its heading and its date.

## What it reads

It reads `package.json`, `CHANGELOG.md` and the git history from the repository root.
It finds releases in the version bumps of `package.json` across all of `HEAD` ancestry, so a checkout without tags writes the same file.
It refuses a shallow checkout, since the releases reach back past its history.
It refuses a `package.json` with no repository address, since each entry links its pull request under it.
It refuses a repository address that is no `https` address once `git+`, a trailing slash and `.git` are dropped, since a pull request link needs one.

## Arguments

```sh
checks-changelog
```

It takes no arguments.
Run it through the build, as the release workflow in [checks-release-notes](checks-release-notes.md) shows.

## Exit codes

| Code | Result |
| --- | --- |
| 0 | The changelog was written. |
| 2 | The checkout is shallow, or `package.json` has no `https` repository address. |

## Sample output

```
checks-changelog: wrote 2 release(s) to CHANGELOG.md
```

## Opting out

Nothing runs it but the build of a repository that keeps a changelog.
A repository with no versioned releases leaves it out.

## Related topics

- [checks-release-notes](checks-release-notes.md)
- [checks-release-report](checks-release-report.md)
