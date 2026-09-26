---
kind: reference
audience: consumers
---
# checks-release-report

`checks-release-report` tells whether the history holds unreleased features or fixes since the last tag.

## What it checks

It lists the conventional commits after the last tag reachable from `HEAD`.
It counts a commit when its subject falls in Features, Fixes, Performance, Reverts or Breaking changes, the groups `checks-changelog` writes.
It prints each unreleased subject on its own line under a count.
A repository with no tag yet reports every conventional commit in its history.
A history with no conventional release-worthy commit reports no unreleased changes.

## What it reads

It reads the tags and the commit subjects from the git history.
It refuses a shallow checkout, since the tag it sees may not be the last one.
It refuses a last tag that opens with no `v`, since a release tag opens with one.

## Arguments

```sh
checks-release-report
```

It takes no arguments.
Run it before cutting a tag to decide whether a release is due.

## Exit codes

| Code | Result |
| --- | --- |
| 0 | No unreleased changes were found. |
| 1 | Unreleased changes were found. |
| 2 | The arguments do not parse, or the history cannot be read. |

## Sample output

A history with unreleased changes prints the count and each subject:

```
release-report: 2 unreleased change(s) since v0.1.0:
  feat: price a bill (#4)
  fix(parts): keep the order of parts (#3)
```

A history with nothing to release prints one line:

```
release-report: no unreleased changes since v0.1.0
```

## Opting out

Nothing runs it but a person or a scheduler deciding when to cut a release.
A repository with no versioned releases leaves it out.

## Related topics

- [checks-changelog](checks-changelog.md)
- [checks-release-notes](checks-release-notes.md)
