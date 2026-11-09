---
kind: reference
audience: consumers
---
# checks-test

`checks-test` runs the test suite and rejects skips without a reason at the test site.

## What it checks

It runs the unit tier plus the smoke list outside CI and the full suite under CI, except a `--changed` run, as [Changed-file runs](#changed-file-runs) says.
It refuses `--full`, `--tier=e2e` and `--tier=pixel` outside CI, except a pixel run that approves pictures, as [Runs refused outside CI](#runs-refused-outside-ci) says.
It runs them with `bun test --randomize --parallel=<workers>`, as [Parallel runs](#parallel-runs) says, and reads Bun's JUnit report from that run.
It runs Bun with `CI=true`, so `test.only` fails the run in every environment.
Bun exits zero when tests skip, so `checks-test` checks every skipped test against its source declaration.
A test that `test.skip`, `test.skipIf`, `test.if`, `test.todo` or an enclosing `describe.skip` skips fails unless the test declares its reason.

Import `skipReason` from `@avi2dg/checks/scripts/test-skips.ts` beside the native Bun test call:

```ts
import { skipReason } from "@avi2dg/checks/scripts/test-skips.ts";

test.skipIf(!hasNix)(
  skipReason("Nix is unavailable", "loads the theme"),
  () => loadTheme(),
);
```

`skipReason` requires a literal reason and a literal test name.
It returns the test name unchanged, and `checks-test` reads the reason, the name and the source line from the test file.
The Bun call stays at the test site so the JUnit report points to the line where its first argument starts.
Use `test.skip(skipReason(reason, name), fn)` for an unconditional skip and `test.todo(skipReason(reason, name))` for a todo.
A skip is declared on the test itself and only there.
`checks-test` refuses `skipReason` on `describe.skip`, `describe.skipIf` or `describe.if`, so declare each test inside the describe instead.

Add `"ci"` or `"local"` as the third `skipReason` argument when a declaration applies to one environment.
Omit the third argument when it applies in both environments.
A declaration for the other environment is not judged in the current run.
Bun sees `CI` set in every `checks-test` run, so a `"ci"` skip whose condition reads `process.env.CI` also skips in a local run and fails there as undeclared.
Gate a `"ci"` skip on what CI lacks, such as a daemon or a tool, and never on `process.env.CI`.

A declaration whose test passes or does not register fails a CI run.
A local run warns about the same declaration because a condition can depend on the machine.
A skipped test or a todo without `skipReason` fails in every environment.

## What it reads

`checks-test` reads test source files and the JUnit report written by its own run.
A pull request run also reads the event file, the git history between the base and the head, the tracked sources, `package.json` and `bunfig.toml`.
A `--changed` run also reads the git history since the merge base with `origin/<default branch>`, the working tree diff and the untracked files.
It reads the sources, `package.json` and `bunfig.toml` too, as [Changed-file runs](#changed-file-runs) says.
It reads no skip list from `package.json`, only the smoke list.
It counts a run as `ci` when `CI` is true and as `local` otherwise.
A local run covers `./tests/unit` plus the smoke list the repository declares, except a `--changed` run, as [Changed-file runs](#changed-file-runs) says.
The smoke list lives in `package.json` under `checks.smoke` as an array of test file paths.
A repository with no smoke list runs the unit tier alone outside CI.
A local run with no unit test and no smoke list runs nothing and passes.
A `ci` run covers the full default suite, unless a pull request narrows it or `--changed` narrows it, as [Pull request runs](#pull-request-runs) and [Changed-file runs](#changed-file-runs) say.
A smoke entry that names no test file fails the run.
A smoke entry under `tests/quarantine/`, `tests/live/` or `tests/pixel/` fails the run, since Bun's ignored paths would drop it.

```json
{
  "checks": {
    "smoke": ["tests/e2e/checkout.test.ts"]
  }
}
```

The default suite takes only the arguments [Arguments](#arguments) lists.
Use `checks-test --tier=live` or `checks-test --tier=pixel` for a named test tier.
Use `checks-test --tier=unit` or `checks-test --tier=e2e` to run only one level of the default suite.
A live or pixel run clears Bun's ignored paths, runs only `./tests/live` or `./tests/pixel`, and still checks each skip.
Outside CI, the live and unit tiers run and the e2e tier is refused.
A pixel run outside CI runs only when it approves pictures, as [Runs refused outside CI](#runs-refused-outside-ci) says.
A unit or e2e run keeps Bun's ignored paths, runs only `./tests/unit` or `./tests/e2e`, and still checks each skip.

Files under `tests/quarantine/` are not run or judged, as [checks-test-layout](checks-test-layout.md) says.

## Runs refused outside CI

Outside CI, `checks-test` refuses `--full`, `--tier=e2e` and a `--tier=pixel` run that does not approve pictures before any test runs, and exits 2.
`CI` counts as unset when it is missing or false.
A refused `--full` or `--tier=e2e` run tells the reader to push the branch and open or update its pull request, so CI runs the checks.
The full suite runs at release.
A refused `--tier=pixel` run names `gh workflow run whole-tree-run --ref <branch>`, the workflow [checks-whole-tree-run](checks-whole-tree-run.md#running-it-by-hand) describes.
Push the branch first, so the dispatched run tests the branch instead of the default branch.
A pixel run with `APPROVE_SCREENS` true still runs outside CI, since a CI run cannot write approved pictures back.
[Test the screens of one block](../how-to/test-a-blocks-screens.md#approve-new-pictures) shows that run.
`--tier=live` runs outside CI, since the full suite never includes it and it needs credentials on the local machine.
With `CI` true, every option runs as the rest of this page says.

```
checks-test: refusing a `--full` run outside CI; push the branch and open or update its pull request so CI runs the checks, and the full suite runs at release
```

## Pull request runs

A `ci` run on a `pull_request` event runs only the test files the pull request reaches.
It reads the base and head from the event file `GITHUB_EVENT_PATH` names and the changed paths since their merge base from git.
A test reaches a changed file when it imports it, names its path, runs its `package.json` bin or imports the package by name.
A test also reaches a file through a test helper or a source that reaches it, at any depth.
A source reaches only what it imports, so a registry that lists every bin's path does not make each of its importers reach every bin.
A test that names a fixture's directory reaches each fixture under it.
A changed test always reaches itself.

A shared file runs the whole suite instead:

- a lockfile, `package.json`, a `*.config.*` or `tsconfig` file, `bunfig.toml`, or a tool pin such as `.bun-version`
- a file Bun preloads into every test, or a file a preload imports
- a test helper, which is a file under `tests/` that is neither a test nor a fixture
- a stylesheet, a font, or a layout under `layouts/` or named `layout.*`

A dependency bump changes `package.json` or the lockfile, so it runs the whole suite in every repository.
A release range of only the version in `package.json` and its `CHANGELOG.md` section runs only the tests it reaches instead of the whole suite.
A workflow under `.github/` is not a shared file, since the suite runs under it rather than reading it.
A pull request that changes no file a test reaches runs no test and passes.
The run names how many test files it reached, or which shared file made it run the whole suite.
A change whose paths cannot be read runs the whole suite.
A `workflow_dispatch` run with `base` and `head` inputs narrows to that range, as a pull request run does.
A `workflow_dispatch` run on a `release/` branch without inputs narrows to the release commit it heads.
Any other event without a range runs the whole suite.
`--full` and the live and pixel tiers always run whole.
A narrowed run judges only the skips the files it ran declare.

## Changed-file runs

`checks-test --changed` runs only the unit and e2e test files the change reaches, so a desk run stays short.
The change is every path between where `HEAD` branched from `origin/<default branch>` and `HEAD`, plus the working tree's edits and its untracked files.
A test reaches a changed file as [Pull request runs](#pull-request-runs) says, at any depth.
A changed test file runs alone, without the rest of its tier.
A deleted file and the old name of a renamed file still count, so a test that imports one runs.
A quarantined, live or pixel test never runs.
A shared file never widens the run to the whole suite.
It runs only the tests the change reaches and names each shared file as left to the pull request's whole run.
The run names each test file it reached, or says it reached none and runs no test.
It judges the skips of the files it ran, as any other run does.
A clone with no remote-tracking default branch fails before any test runs and asks for a fetch of it.
A repository runs it from a script of its own, such as:

```json
{
  "scripts": {
    "test:fast": "checks-test --changed"
  }
}
```

## Test tiers

Tests that need a live machine go in `tests/live/`, and tests that need a screen go in `tests/pixel/`.
For example, a test under `tests/e2e/stack/` that skips when Nix is missing moves to the same path under `tests/live/stack/`.
Its skip declares `skipReason("Nix is unavailable", name)` inside its `test.skipIf` call.
Add the matching package scripts when either directory contains tests:

```json
{
  "scripts": {
    "test:live": "checks-test --tier=live",
    "test:pixel": "checks-test --tier=pixel"
  }
}
```

Bun ignores both directories during the default run.
`checks-test-layout` requires each tier script when its directory contains a test file.

## Parallel runs

`checks-test` runs `bun test --randomize --parallel=<workers>`, so Bun hands each test file to one of that many worker processes.
Without `--parallel=<workers>`, the count is one worker per core, as `os.availableParallelism()` reports it, so a local run never oversubscribes the machine.
A repository sets its own count by passing `--parallel=<workers>` in its `test` script:

```json
{
  "scripts": {
    "test": "checks-test --parallel=4"
  }
}
```

The count is a whole number from 1 up.
Each file runs in a fresh global, so a file cannot lean on state another file left behind.
Tests still run in random order, and `test.only` still fails the run.
Bun merges every worker's results into the one JUnit report, so each skipped test and each todo is judged across the whole suite.
A tier script takes the same option, as in `checks-test --tier=live --parallel=4`.
[checks-flake](checks-flake.md#parallel-hunts) hunts with the same worker count.

A file whose worker crashes, for example when a test calls `process.exit`, fails the run.
Bun reports no result from that file, so its skips are not judged and its declarations are not reported as stale.

`checks-test` takes no timings file, because Bun ignores the order a timings file sets whenever `--randomize` is on.
A timings option waits for Bun to honour timings under random order.

## Arguments

The default command takes no arguments except `--parallel=<workers>`, as [Parallel runs](#parallel-runs) says, `--full`, `--changed` and `--junit=<file>`.
`--full` runs the full suite in CI even when a pull request would narrow it, and is refused outside CI, as [Runs refused outside CI](#runs-refused-outside-ci) says.
A `package.json` script never takes `--full`, as [checks-test-layout](checks-test-layout.md) says of `scripts.test`.
`--changed` runs the test files the change reaches, as [Changed-file runs](#changed-file-runs) says, and takes neither a tier nor `--full`.
`scripts.test` never takes `--changed` either, so CI still runs the suite it reaches.
Its named tier options are `--tier=live`, `--tier=pixel`, `--tier=unit` and `--tier=e2e`, and a tier run takes `--parallel=<workers>` too, but not `--full`.
`--junit=<file>` keeps the JUnit report Bun wrote at `<file>`, whether the tests passed or failed, so a whole-tree run hands it to [checks-whole-tree-run](checks-whole-tree-run.md).
A `package.json` script never takes `--junit`, as [checks-test-layout](checks-test-layout.md) says of `scripts.test`.
Each option appears at most once.
It refuses test filters because every test excluded by a filter would look skipped.

## Exit codes

| Code | When |
| --- | --- |
| 0 | every test passed and every skip has a matching site reason |
| 1 | a test failed, a parallel worker crashed, a skip lacks a site reason or a declaration is stale in CI |
| 2 | an argument is not one it takes, a run outside CI is refused, `APPROVE_SCREENS` is not a boolean in a pixel run, a declaration or the smoke list cannot be read, a smoke entry names no runnable test, `CI` is not a boolean, Bun wrote no report or a `--changed` run cannot find where `HEAD` branched from `origin/<default branch>` |

## Sample output

```
checks-test: 1 skipped test(s) undeclared in this local run:
  tests/unit/pricing.test.ts:12 rounds half to even: skipped with no reason at its test site; use test.skipIf(condition)(skipReason(reason, name), fn)
```

A run with no skipped tests ends with:

```
checks-test: no test skipped
```

## When it runs

The repository's `test` script runs it.
A repository that tracks no TypeScript source does not need it, as [checks-test-layout](checks-test-layout.md) says.

## Related topics

- [checks-test-layout](checks-test-layout.md)
- [checks-flake](checks-flake.md)
- [checks-quarantine-clock](checks-quarantine-clock.md)
- [checks-whole-tree-run](checks-whole-tree-run.md)
