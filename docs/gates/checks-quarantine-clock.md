---
kind: reference
audience: consumers
---
# checks-quarantine-clock

`checks-quarantine-clock` is the gate that fails a test left in `tests/quarantine/` past 30 days.

## What it checks

It fails naming each test that entered `tests/quarantine/` more than 30 days before the head.
`checks-test-layout` pins `tests/quarantine/` out of every default run, so a test there protects nothing until it moves back.
Each failure names the file, the day it entered quarantine, and what to do, which is to fix it and move it back, or delete it.
The limit is 30 days for every test, with no setting to raise it.

## What it reads

It lists the test files under `tests/quarantine/` at the head, by the name pattern `checks-test-layout` uses, so a helper or fixture there never ages out.
It walks each file's history with `git log --follow`, so a move or a copy into quarantine starts the clock there rather than at the test's creation.
It measures the age from the author date of the commit that put the file there to the later of the head's author and committer dates, so the same commit always gets the same verdict.
A rebase keeps the entry's author date and moves the head's committer date forward, so rebasing neither restarts the clock nor stops it.

## Arguments

```sh
checks-quarantine-clock <base-ref> <head-ref>
checks-quarantine-clock <ref>
```

With two arguments it judges the head, and the base only satisfies the range `checks-lint` hands every range gate.
With one it judges that commit, including a repository's first commit.

## Exit codes

| Code | When |
| --- | --- |
| 0 | no test in `tests/quarantine/` is past 30 days |
| 1 | a test in `tests/quarantine/` is past 30 days |
| 2 | a ref does not resolve, or the history ends before a file's entry into quarantine, as in a shallow clone |

## Sample output

```
quarantine-clock: 1 test(s) in tests/quarantine/ is past 30 days; fix each and move it back, or delete it:
  tests/quarantine/unit/billing.test.ts entered quarantine on 2026-08-01 (45 days ago)
```

## When it runs

`checks-lint` runs it over each pull request's range in every repository, as [checks-lint](checks-lint.md) says.
A repository with no test file under `tests/quarantine/` passes with nothing checked.

## Related topics

- [checks-test-layout](checks-test-layout.md)
- [checks-lint](checks-lint.md)
