---
kind: reference
audience: consumers
---
# checks-mutation-merge

`checks-mutation-merge` merges the Stryker reports of a sharded mutation run into one report, and the shards' incremental states into one state the same way.

## What it checks

It merges rather than judging, so it fails only when the shards cannot form one run.
A Stryker incremental state has the same shape as a report, so one bin merges both.

Each shard mutates files no other shard mutates, so the merged report keeps each file and its mutants as the shard wrote them.
A file in two shards fails the run, since one shard's mutants would replace the other's.

Every shard runs the same tests, but each Stryker run numbers its tests from zero.
So a test is one test across shards when its file, name and location match.
The merged report numbers each test and each mutant once, and points each mutant's `coveredBy` and `killedBy` at the new test numbers.
A test file whose recorded source differs between shards fails the run, since those shards ran different commits.
A mutant that names a test its own report does not hold fails the run too.

The merged report takes its schema version, thresholds, project root and framework from the first shard.
Shards with different schema versions fail the run.

## What it reads

- Each shard's `mutation.json` or `stryker-incremental.json`, as Stryker wrote it.

## Arguments

```sh
checks-mutation-merge <output> <shard-report>...
```

`<output>` is the path the merged file goes to, with its directory made when missing.
Each `<shard-report>` is one shard's report or one shard's incremental state, and one is enough.

## Output

It writes the merged file to `<output>`.
On stderr it names how many reports it merged and the files, mutants and tests the merged file holds.
On a failure it writes nothing.

## Exit codes

| Code | When |
| --- | --- |
| 0 | it wrote the merged file |
| 2 | the arguments do not parse, a shard does not load as a Stryker report, two shards hold one file, a test file's source differs between shards, a mutant names a test its report lacks, or the merged file cannot be written |

## Sample output

```
mutation-merge: 4 report(s) into reports/mutation/mutation.json, with 62 file(s), 1231 mutant(s) and 774 test(s)
```

A shard list that two shards share a file in, on stderr:

```
mutation-merge: src/a.ts is in both shards/1/mutation.json and shards/2/mutation.json, so the shards did not split the mutated files
```

## When it runs

A whole-tree run split by [checks-mutation-scope](checks-mutation-scope.md#splitting-a-whole-tree-run) runs it once every shard finishes, before the run saves its report and state:

```yaml
- name: Merge the shards
  run: |
    bunx checks-mutation-merge reports/mutation/mutation.json shards/*/mutation.json
    bunx checks-mutation-merge reports/stryker-incremental.json shards/*/stryker-incremental.json
```

## Related topics

- [checks-mutation-scope](checks-mutation-scope.md)
- [checks-mutation](checks-mutation.md)
- [checks-mutation-baseline](checks-mutation-baseline.md)
