---
kind: reference
audience: consumers
---
# checks-test

`checks-test` runs the test suite and rejects skips without a reason at the test site.

## What it checks

It runs the default suite with `bun test --randomize` and reads Bun's JUnit report from that run.
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
It does not read a skip list from `package.json`.
It counts a run as `ci` when `CI` is true and as `local` otherwise.

The command takes no arguments for the default suite, except the worker count of [Parallel runs](#parallel-runs) and the file `--junit` keeps the report at.
Use `checks-test --tier=live` or `checks-test --tier=pixel` for a named test tier.
Use `checks-test --tier=unit` or `checks-test --tier=e2e` to run only one level of the default suite.
A live or pixel run clears Bun's ignored paths, runs only `./tests/live` or `./tests/pixel`, and still checks each skip.
A unit or e2e run keeps Bun's ignored paths, runs only `./tests/unit` or `./tests/e2e`, and still checks each skip.

Files under `tests/quarantine/` are not run or judged, as [checks-test-layout](checks-test-layout.md) says.

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

A repository runs its test files in parallel by passing a worker count in its `test` script:

```json
{
  "scripts": {
    "test": "checks-test --parallel=4"
  }
}
```

`checks-test --parallel=<workers>` runs `bun test --randomize --parallel=<workers>`, so Bun hands each test file to one of that many worker processes.
Each file then runs in a fresh global, so a file cannot lean on state another file left behind.
The count is a whole number from 1 up, and without the option the suite runs serially in one process.
Tests still run in random order, and `test.only` still fails the run.
Bun merges every worker's results into the one JUnit report, so each skipped test and each todo is judged as in a serial run.
A tier script takes the same option, as in `checks-test --tier=live --parallel=4`.
[checks-flake](checks-flake.md#parallel-hunts) hunts with the worker count the `test` script sets.

A file whose worker crashes, for example when a test calls `process.exit`, fails the run.
Bun reports no result from that file, so its skips are not judged and its declarations are not reported as stale.

`checks-test` takes no timings file, because Bun ignores the order a timings file sets whenever `--randomize` is on.
A timings option waits for Bun to honour timings under random order.

## Arguments

The default command takes no arguments except `--parallel=<workers>`, as [Parallel runs](#parallel-runs) says, and `--junit=<file>`.
Its named tier options are `--tier=live`, `--tier=pixel`, `--tier=unit` and `--tier=e2e`, and a tier run takes `--parallel=<workers>` too.
`--junit=<file>` keeps the JUnit report Bun wrote at `<file>`, whether the tests passed or failed, so a night run hands it to [checks-night-run](checks-night-run.md).
A `package.json` script never takes `--junit`, as [checks-test-layout](checks-test-layout.md) says of `scripts.test`.
Each option appears at most once.
It refuses test filters because every test excluded by a filter would look skipped.

## Exit codes

| Code | When |
| --- | --- |
| 0 | every test passed and every skip has a matching site reason |
| 1 | a test failed, a parallel worker crashed, a skip lacks a site reason or a declaration is stale in CI |
| 2 | an argument is not one it takes, a declaration cannot be read, `CI` is not a boolean or Bun wrote no report |

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
- [checks-night-run](checks-night-run.md)
