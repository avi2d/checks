# checks-subsumed-tests

`checks-subsumed-tests` is the report that lists each test another test subsumes in a Stryker mutation run, and a reader looks it up to judge whether the suite carries tests it no longer needs.

## What it checks

It checks nothing and fails nothing.
It reads one Stryker `mutation.json` report, gives each test the set of mutants it kills, and prints each test whose kill set sits inside the kill set of one other test beside that test, with both kill counts.
It then prints the tests whose kill sets are identical, then the size of a greedy cover that keeps every kill.
A test is subsumed when its kill set sits inside the kill set of one other test, so dropping every subsumed test loses no kill in this run.
The report informs a person and decides nothing, so keep a subsumed test unless reading the pair shows the same scenario.
A subsumed verdict trusts the mutants the run covers, so read the files the report names before judging a test redundant.
A test judged against a module that is not its subject looks redundant until its own subject is mutated.
A test whose subject no mutant can touch, such as frontmatter or links, looks redundant because mutation cannot see what it checks.

## What it reads

It reads one Stryker `mutation.json` report built with bail off, which the shared Stryker preset's `json` reporter writes to `reports/mutation/mutation.json`.
With `disableBail` Stryker runs every covering test for each mutant and records every test that fails as a killer, so each test gets a kill set.
A report built with bail on records one killer per mutant, which makes every test look unique.
The report records no flag that says whether bail was on, so build it with `disableBail` set.

## Arguments

```sh
checks-subsumed-tests <mutation-report>
```

## Exit codes

| Code | When |
| --- | --- |
| 0 | the report printed |
| 2 | the report is not a Stryker mutation report, or the arguments do not parse |

## Sample output

It prints the files the run mutated, then each subsumed test beside the test that subsumes it, then the tests whose kill sets are identical, then the greedy cover:

```
subsumed-tests: 2 file(s) mutated
  mutated src/a.ts
  mutated src/b.ts
subsumed tests (1):
  "narrow" (1 kill) subsumed by "wide" (3 kills)
identical kill sets (1 group(s)):
  "twin-a" (2 kills) = "twin-b" (2 kills)
greedy cover: 3 of 5 test(s) keep all 6 kill(s)
  cover "wide"
  cover "twin-a"
  cover "loner"
```

## Opting out

Nothing runs it but a person who wants the figures.

## Related topics

- [checks-mutation-compare](checks-mutation-compare.md)
