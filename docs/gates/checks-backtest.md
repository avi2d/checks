# checks-backtest

`checks-backtest` is the report of what the comment check would have refused at each recent commit, and a reader looks it up to measure a repository's own history before adopting the check.

## What it checks

It checks nothing and fails nothing.
It walks recent first-parent commits, prints a row per commit that touches code and then the totals, attributes only the refusals each commit introduced, and counts new comment text as a share of added lines.
A row holds the commit, its added lines, its added comment lines, its refusals and its subject.
Each commit that introduced a refusal is then listed with its refusals.

## What it reads

It reads each commit and its first parent, and the files each commit changes that have a comment syntax in `scripts/comment-matchers.ts`.
`generated/`, `vendor/`, `repos/`, `node_modules/` and `dist/` are out of reach, so the figures are authored code.

## Arguments

```sh
checks-backtest [commit-count]
```

`commit-count` is the number of first-parent commits it walks, 60 when absent.

## Exit codes

| Code | When |
| --- | --- |
| 0 | the report printed |
| 2 | it is given more than one argument, or git cannot read the history, as with a count git refuses |

## Sample output

```
fe12189	9	0	0	feat(scripts): hold CONTRIBUTING.md to the how-to template
086bdd0	1205	1	0	feat(scripts): add checks-docs gate holding doc files to s
dc23b30	21	1	0	fix: release 0.12.0 and read local exports in checks-featu
bcb4e3b	1252	4	0	feat(scripts): add size budget, feature-owner rules and ch
4 commits touching code, 2487 added lines
comment lines added: 6 (0.2% of added lines)
refusals introduced: 0
```

## Opting out

Nothing runs it but a person who wants the figures.

## Related topics

- [checks-comment-gate](checks-comment-gate.md)
