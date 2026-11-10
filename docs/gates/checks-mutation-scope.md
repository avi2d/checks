---
kind: reference
audience: consumers
---
# checks-mutation-scope

`checks-mutation-scope` turns a branch's diff into the files its mutation runs mutate, and prints them as `NAME=a,b` lines a CI step appends to its environment file.
With `--shards`, it splits every file a whole-tree run mutates into groups that each run on a job of their own.

## What it checks

It picks a scope rather than judging one, so it fails only when it cannot pick one.
It reads `git diff --name-status -M` from the merge base of `<base>` and `HEAD` to `HEAD`.
A changed source enters the scope when the repository's own Stryker `mutate` globs match it, with each negated glob applied in order.
It resolves each glob and each path against the working directory, as Stryker does, so an absolute glob matches too.
A `mutate` entry with a mutation range, such as `src/a.ts:1-10`, fails the run, since a scope of whole files cannot keep the range.
`--mutate` replaces those globs, so a path the config excludes, such as `packages/*/src/live/**` or `packages/*/src/bin.ts`, stays out of the scope.
A renamed source enters under both names, and a deleted source does not enter.

A unit test is a `.test.ts` or `.test.tsx` file under `tests/unit/`, the files the preset's `unitTestFiles` lists.
A unit test the branch adds, edits, deletes or renames is changed.
A unit test that reads a changed file under `tests/` is changed too.
It reads a file when it imports it, directly or through another file under `tests/`.
An import resolves as Bun resolves it, to the file it names, then with an extension added, and only then to the directory's `index`.
A unit test also reads a changed fixture under `tests/fixtures/` when it names the fixture's path or a directory above it.
Bun loads each `[test] preload` in `bunfig.toml` before every test file.
So every unit test is changed when the preload list differs between the merge base and `HEAD`.
The same holds when the branch changes a preload or a file a preload imports, wherever that file lives.

Each source whose mutants a changed unit test covers or kills in the full baseline report then enters the scope, when it still exists at `HEAD`.
So a kill lost through a test change alone still shows in the comparison, in a source the branch leaves alone.
A changed unit test with no baseline report adds no covered source to the scope.
With no other change the scope stays empty and the comparison skips.
The scope step names the missing full baseline on stderr.
Refresh the full baseline with gh workflow run mutation with mode refresh.
Stryker records each test file's source in the report's `testFiles`.
A changed unit test the merge base holds must have that recorded source match its content at the merge base.
Otherwise the report ran an older test, so its coverage cannot say what the test covers now.
The scope then widens to every file at `HEAD` the `mutate` globs match.
A unit test the branch adds is new to every report, so it needs no entry.
Stryker writes no source without mutants into the report, so a mutated source the report lacks may be newer than it.
When a unit test changed, each such source that exists at `HEAD` enters the scope.
A change under `tests/e2e/` changes no unit test, so it needs no baseline report.
The scope trusts the coverage edges of the latest full baseline.
So a helper, fixture or preload changed on `main` since that baseline can hide a lost kill until the next full baseline refreshes.

## Splitting a whole-tree run

`checks-mutation-scope --shards <count>` takes every file git tracks at `HEAD` that the `mutate` globs match, with each negated glob applied in order.
It splits those files into at most `<count>` shards, so a refresh run spreads across that many jobs while a baseline stays a single incremental run.
Each file weighs the mutants the last report holds for it that a refresh runs, leaving out each mutant with `static` true or status `Ignored` or `NoCoverage`, since a refresh skips the first two and runs no test for the third.
A file the last report lacks may be newer than that report.
So it weighs the average count of the reported files the globs still match, rounded up and at least one.
With no last report operand, each file weighs one mutant, so the shards split by file count.
A named last report with no file, or a file that does not load as a Stryker report, fails the run instead.
Each file in turn, heaviest first and then by path, joins the shard with the fewest mutants so far, the lowest numbered on a tie.
A shard with no file is left out, so fewer files than `<count>` print fewer shards.

## What it reads

- The diff from the merge base to `HEAD`, and the files git tracks at both.
- The Stryker config file `stryker run` loads from the working directory, such as `stryker.conf.mjs`, for its `mutate` globs.
  It imports a JavaScript config, so the step runs after `bun install`.
  With no config file, or a config with no `mutate`, it takes Stryker's default globs.
- `bunfig.toml` at the merge base and at `HEAD`, for its `[test] preload` entries.
- Each preload at `HEAD`, and each file it imports through a relative path, for the files the preloads load.
- Each tracked `.ts` and `.tsx` file under `tests/` from the working tree, for its relative imports and the fixture paths it names.
- Each changed unit test at the merge base, to match it against the source the report recorded.
- The full baseline report that `checks-mutation-baseline --full` restores, for each mutant's `coveredBy` and `killedBy` and the `testFiles` that own those tests.
- With `--shards`, the last report, for the number of mutants in each file that a refresh runs.

Stryker leaves `coveredBy` empty on a static mutant, so only `killedBy` names its tests.
A reused result needs its affected tests, sources, and configuration invalidated before reuse, so each mutant's tests are the ones the run recorded.
With bail, Stryker's default, `killedBy` names the one test that killed the mutant first.
One killer is enough, since a branch loses a kill through its tests only when it changes every test that made the kill.
A test left alone, whose sources the branch also leaves alone, still kills the mutant at `HEAD`.
So whichever killer the report names is a changed test, and a deleted test counts as changed.

## Arguments

```sh
checks-mutation-scope <base> [<full-baseline-report>]
checks-mutation-scope --shards <count> [<last-report>]
```

`<base>` is the target branch, such as `origin/main`, or the merge base itself.
`<full-baseline-report>` is the path the full baseline was restored to.
A path with no file reads as no report, and a changed unit test then adds no covered source.
`<count>` is a whole number from 1 to 256, the most jobs one GitHub Actions matrix runs.
`<last-report>` is the path of the last whole-tree report.
With no `<last-report>`, each file weighs one mutant, and a path with no file fails the run.

## Output

It prints one line for each list, as `NAME=a,b`, with each list sorted by path:

| Line | What it lists |
| --- | --- |
| `SCOPE` | the files the incremental head run mutates, empty when nothing in mutation scope changed |
| `STALE_TESTS` | the unit tests that count as changed only because they read a changed file |

Stryker reads each `--mutate` entry as a glob and turns each backslash into a `/`.
So `SCOPE` wraps each glob character in a path in a class of its own.
`app/routes/[id].ts` prints as `app/routes/[[]id[]].ts`, which matches that file and not `app/routes/i.ts`.
`STALE_TESTS` names each test by its literal path, as the incremental state keys it.

With `--shards`, it prints one `SHARDS` line instead, a JSON list a matrix reads with `fromJSON`.
Each entry is one shard's files, escaped as `SCOPE` escapes them and joined with commas, so it passes to `--mutate` as it stands.
On stderr it names each shard's file count and mutant weight.

Stryker compares only a test file's own source when it resumes from incremental state.
A run that resumes from the saved `main` baseline drops each `STALE_TESTS` entry from that state first, so Stryker retests the mutants those tests cover.

On stderr it names each unit test that reads a changed file, and each source a changed unit test brings in.
It also names each stale test that widens the scope.

## Exit codes

| Code | When |
| --- | --- |
| 0 | it printed the scope or the shards, an empty list included |
| 2 | the arguments do not parse, git fails, the Stryker config, `bunfig.toml`, the baseline report or the last report does not load, or a `mutate` entry names a mutation range |

## Sample output

A helper change that reaches a source the branch leaves alone:

```
mutation-scope: tests/unit/dashboard/snapshot.test.ts reads tests/lib/session-fixture.ts
mutation-scope: packages/ui/src/layout.ts enters through tests/unit/dashboard/snapshot.test.ts
SCOPE=packages/session-quota/src/notes.ts,packages/ui/src/layout.ts
STALE_TESTS=tests/unit/dashboard/snapshot.test.ts
```

A whole-tree run split three ways:

```
mutation-scope: shard 1 holds 2 file(s) and about 9 mutant(s)
mutation-scope: shard 2 holds 1 file(s) and about 8 mutant(s)
mutation-scope: shard 3 holds 2 file(s) and about 8 mutant(s)
SHARDS=["src/a.ts,src/b.ts","src/c.ts","src/d.ts,src/e.ts"]
```

A changed unit test with no full baseline on `main` skips the comparison, on stderr:

```
mutation-scope: tests/unit/dashboard/snapshot.test.ts changed, but no full baseline report at /runner/temp/baseline-full/mutation.json says which sources they cover, so the scope holds no covered source. Refresh the full baseline with gh workflow run mutation with mode refresh.
```

A changed unit test that `main` edited after its newest full baseline, on stderr:

```
mutation-scope: the baseline report did not run tests/unit/dashboard/snapshot.test.ts as the merge base holds it, so every mutated source enters
```

## When it runs

Only a CI step runs it, in a branch's mutation comparison before the incremental head run.
The shared `mutation` workflow runs it in its compare and refresh jobs, and a step the repository writes runs it too:

```yaml
- name: Select mutation scope
  env:
    GH_TOKEN: ${{ github.token }}
  run: |
    base="$(git merge-base HEAD origin/main)"
    echo "BASE_SHA=$base" >> "$GITHUB_ENV"
    bunx checks-mutation-baseline --full "$RUNNER_TEMP/baseline-full/mutation.json"
    bunx checks-mutation-scope "$base" "$RUNNER_TEMP/baseline-full/mutation.json" >> "$GITHUB_ENV"
```

Each later step reads `SCOPE` from the environment, and a failed scope step adds nothing to it.
[checks-mutation-compare](checks-mutation-compare.md#running-it-in-ci) shows the comparison it scopes.
The full baseline comes from the `mutation` workflow, as [checks-mutation](checks-mutation.md#running-it-in-ci) shows.

## Related topics

- [checks-mutation-compare](checks-mutation-compare.md)
- [checks-mutation](checks-mutation.md)
- [checks-mutation-baseline](checks-mutation-baseline.md)
