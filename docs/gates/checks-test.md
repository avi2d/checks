# checks-test

`checks-test` runs the test suite and rejects skips without a reason at the test site.

## What it checks

It runs the default suite with `bun test --randomize` and reads Bun's JUnit report from that run.
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

A declaration whose test passes or does not register fails a CI run.
A local run warns about the same declaration because a condition can depend on the machine.
A skipped test or a todo without `skipReason` fails in every environment.

## What it reads

`checks-test` reads test source files and the JUnit report written by its own run.
It does not read a skip list from `package.json`.
It counts a run as `ci` when `CI` is true and as `local` otherwise.

The command takes no arguments for the default suite.
Use `checks-test --tier=live` or `checks-test --tier=pixel` for a named test tier.
A tier run clears Bun's ignored paths, runs only `./tests/live` or `./tests/pixel`, and still checks each skip.

Files under `tests/quarantine/` are not run or judged, as [checks-test-layout](checks-test-layout.md) says.

## Move testSkips entries to test sites

Delete each `testSkips` entry from `package.json` after you add its reason beside the native test call.
Keep its `when` value as the third argument to `skipReason`.

Move tests that need a live machine into `tests/live/` and tests that need a screen into `tests/pixel/`.
For example, a test under `tests/e2e/stack/` that skips when Nix is missing moves to the same path under `tests/live/stack/`.
Its `testSkips` entry becomes `skipReason("Nix is unavailable", name)` inside its `test.skipIf` call.
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

## Arguments

The default command takes no arguments.
Its named tier options are `--tier=live` and `--tier=pixel`.
It refuses test filters because every test excluded by a filter would look skipped.

## Exit codes

| Code | When |
| --- | --- |
| 0 | every test passed and every skip has a matching site reason |
| 1 | a test failed, a skip lacks a site reason or a declaration is stale in CI |
| 2 | a declaration cannot be read, `CI` is not a boolean or Bun wrote no report |

## Sample output

```
checks-test: 1 skipped test(s) undeclared in this local run:
  tests/pricing.test.ts:12 rounds half to even: skipped with no reason at its test site; use test.skipIf(condition)(skipReason(reason, name), fn)
```

A run with no skipped tests ends with:

```
checks-test: no test skipped
```

## Opting out

A repository that tracks no TypeScript source does not need `checks-test`, as [checks-test-layout](checks-test-layout.md) says.

## Related topics

- [checks-test-layout](checks-test-layout.md)
- [checks-flake](checks-flake.md)
- [checks-quarantine-clock](checks-quarantine-clock.md)
