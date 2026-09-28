---
kind: reference
audience: consumers
---
# checks-release-report

`checks-release-report` tells whether the history holds unreleased features or fixes since the last tag.

## What it checks

It lists the conventional commits after the last tag reachable from `HEAD` that reads as a version such as `v0.2.0`.
It counts a commit when its subject falls in Features, Fixes, Performance, Reverts or Breaking changes, the groups `checks-changelog` writes.
It prints each unreleased subject on its own line under a count.
A repository with no tag yet reports every such commit in its history.
A history with no conventional release-worthy commit reports no unreleased changes.

## What it reads

It reads the tags and the commit subjects from the git history.
It refuses a shallow checkout, since the tag it sees may not be the last one.
It passes over any other tag, since only a release tag reads as a version.

## Arguments

```sh
checks-release-report
```

It takes no arguments.
Run it to see whether a release is due and what it holds.

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

## When it runs

The daily release workflow runs it once a day, and runs [checks-release-pr](checks-release-pr.md) when it exits 1, as [Running it in CI](checks-release-pr.md#running-it-in-ci) shows.
A person runs it to see what the next release holds.
A repository with no versioned releases does not need it.

## Related topics

- [checks-changelog](checks-changelog.md)
- [checks-release-notes](checks-release-notes.md)
- [checks-release-pr](checks-release-pr.md)
