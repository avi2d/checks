# checks-quarantine-clock

`checks-quarantine-clock` is the gate that fails a test left in `tests/quarantine/` past 30 days, and a reader looks it up when a quarantined test went red.

## What it checks

It fails naming each test that entered `tests/quarantine/` more than 30 days before the head.
`checks-test-layout` pins `tests/quarantine/` out of every default run, so a test there protects nothing until it moves back.
Each failure names the file, the day it entered quarantine, and what to do, which is to fix it and move it back, or delete it.
The limit is 30 days for every file, with no setting to raise it.
GitLab quarantines fast for 3 days and long term for at most 3 months, then opens a deletion merge request automatically.

## What it reads

It lists the files under `tests/quarantine/` at the head.
It walks each file's history with `git log --follow`, so a move into quarantine starts the clock at the move rather than at the test's creation.
It measures the age from the author date of the commit that put the file there to the author date of the head, so the same commit always gets the same verdict.
A rebase keeps the author date, so the clock cannot be restarted that way.

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
  tests/quarantine/billing.test.ts entered quarantine on 2026-08-01 (45 days ago)
```

## Opting out

It applies to every repository, so no selection leaves it out.
A repository with no file under `tests/quarantine/` passes with nothing checked.
`checks-lint` runs it over each pull request's range, as [checks-lint](checks-lint.md) says.

## Related topics

- [checks-test-layout](checks-test-layout.md)
- [checks-lint](checks-lint.md)
