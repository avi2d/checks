---
kind: reference
audience: consumers
---
# checks-mutation-scope

`checks-mutation-scope` turns a pull request's diff into the files its mutation runs mutate, and prints them as lines for `GITHUB_ENV`.

## What it checks

It picks a scope rather than judging one, so it fails only when it cannot pick one.
It reads `git diff --name-status -M` from the merge base of `<base>` and `HEAD` to `HEAD`.
A changed source enters the scope when the repository's own Stryker `mutate` globs match it, with each negated glob applied in order.
`--mutate` replaces those globs, so a path the config excludes, such as `packages/*/src/live/**` or `packages/*/src/bin.ts`, stays out of the scope.
A renamed source enters under both names, and a deleted source does not enter.

A unit test is a `.test.ts` or `.test.tsx` file under `tests/unit/`, the files the preset's `unitTestFiles` lists.
A unit test the pull request adds, edits, deletes or renames is changed.
A unit test that reads a changed file under `tests/` is changed too.
It reads a file when it imports it, directly or through another file under `tests/`.
Each `[test] preload` in `bunfig.toml` counts as imported by every test file.
A unit test also reads a changed fixture under `tests/fixtures/` when it names the fixture's path or a directory above it.

Each source whose mutants a changed unit test covers or kills in the full baseline report then enters the scope, when it still exists at `HEAD`.
So a kill lost through a test change alone still shows in the comparison, in a source the pull request leaves alone.
A changed unit test with no baseline report fails the run rather than reading incomplete coverage.
A change under `tests/e2e/` changes no unit test, so it needs no baseline report.

## What it reads

- The diff from the merge base to `HEAD`, and the files git tracks at both.
- The Stryker config file `stryker run` loads from the working directory, such as `stryker.conf.mjs`, for its `mutate` globs.
  It imports a JavaScript config, so the step runs after `bun install`.
  With no config file, or a config with no `mutate`, it takes Stryker's default globs.
- `bunfig.toml` for its `[test] preload` entries.
- Each tracked `.ts` and `.tsx` file under `tests/` from the working tree, for its relative imports and the fixture paths it names.
- The full baseline report that `checks-mutation-baseline --full` restores, for each mutant's `coveredBy` and `killedBy` and the `testFiles` that own those tests.

Stryker leaves `coveredBy` empty on a static mutant, so only `killedBy` names its tests.
The report must come from a run that restored no state and passed `--disableBail`, which lists every killing test.

## Arguments

```sh
checks-mutation-scope <base> [<full-baseline-report>]
```

`<base>` is the branch the pull request merges into, such as `origin/main`, or the merge base itself.
`<full-baseline-report>` is the path the full baseline was restored to, and a path with no file reads as no report.

## Output

It prints one line for each list, as `NAME=a,b`, with each list sorted by path:

| Line | What it lists |
| --- | --- |
| `SCOPE` | the files the base and head runs both mutate, empty when nothing in mutation scope changed |
| `ADDED` | the scoped files the merge base lacks, including a source renamed in from outside the globs |
| `RENAMED` | each source renamed within the globs, as `old:new` |
| `TESTS` | every changed unit test |
| `STALE_TESTS` | the unit tests that count as changed only because they read a changed file |

Stryker compares only a test file's own source when it resumes from incremental state.
A run that resumes from the merge base's state drops each `STALE_TESTS` entry from that state first, so Stryker retests the mutants those tests cover.

On stderr it names each unit test that reads a changed file, and each source a changed unit test brings in.

## Exit codes

| Code | When |
| --- | --- |
| 0 | it printed the scope, an empty one included |
| 2 | the arguments do not parse, git fails, the Stryker config, `bunfig.toml` or the baseline report does not load, or a unit test changed with no baseline report |

## Sample output

A helper change that reaches a source the pull request leaves alone:

```
mutation-scope: tests/unit/dashboard/snapshot.test.ts reads tests/lib/session-fixture.ts
mutation-scope: packages/ui/src/layout.ts enters through tests/unit/dashboard/snapshot.test.ts
SCOPE=packages/session-quota/src/notes.ts,packages/ui/src/layout.ts
ADDED=
RENAMED=
TESTS=tests/unit/dashboard/snapshot.test.ts
STALE_TESTS=tests/unit/dashboard/snapshot.test.ts
```

A changed unit test with no full baseline on `main`, on stderr:

```
mutation-scope: tests/unit/dashboard/snapshot.test.ts changed, but no baseline report at /runner/temp/baseline-full/mutation.json says which sources they cover
```

## When it runs

Only a CI step the repository writes runs it, in the pull request's mutation comparison, before either Stryker run:

```yaml
- name: Select mutation scope
  env:
    GH_TOKEN: ${{ github.token }}
  run: |
    base="$(git merge-base HEAD "origin/$GITHUB_BASE_REF")"
    echo "BASE_SHA=$base" >> "$GITHUB_ENV"
    bunx checks-mutation-baseline --full "$RUNNER_TEMP/baseline-full/mutation.json"
    bunx checks-mutation-scope "$base" "$RUNNER_TEMP/baseline-full/mutation.json" >> "$GITHUB_ENV"
```

Each later step reads `$SCOPE` from the environment, and a failed scope step adds nothing to it.
[checks-mutation-compare](checks-mutation-compare.md#running-it-in-ci) shows the whole job.
The full baseline comes from the `mutation` workflow, as [checks-mutation](checks-mutation.md#running-it-in-ci) shows.

## Related topics

- [checks-mutation-compare](checks-mutation-compare.md)
- [checks-mutation](checks-mutation.md)
- [checks-mutation-baseline](checks-mutation-baseline.md)
