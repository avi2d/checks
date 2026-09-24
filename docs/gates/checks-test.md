# checks-test

`checks-test` is the entry point that runs the whole suite and refuses a skip the repository has not declared, and a reader looks it up to declare a skip.

## What it checks

It runs the whole suite with `bun test --randomize`, passes bun's output through, and then reads bun's JUnit report of the same run.
bun exits 0 with tests skipped, so a green run says nothing about the tests that never ran.
`checks-test` fails when a test failed, or when a test was skipped without a declaration in `package.json`.
A test counts as skipped through `test.skip`, `test.skipIf`, `test.if`, `describe.skip` or `test.todo`.

A declaration names the test and says why it skips:

```json
"testSkips": [
  {
    "file": "tests/e2e/docker.test.ts",
    "test": "images > builds the release image",
    "reason": "the runner has no docker daemon",
    "when": "ci"
  }
]
```

`file` is the path bun reports, relative to the package root.
`test` is the name bun's console prints, the describe blocks and the test name joined by ` > `.
`reason` is required.
`when` is `ci` or `local` for a test skipped only there, and a declaration without it holds in both.

A declaration that holds for the run but matches no skipped test fails a ci run too, so a fixed or renamed test takes its declaration with it.
A local run only warns about it, because whether a test skips there can hang on the machine, such as a docker daemon being up.
Files under `tests/quarantine/` are never run and so never reported, as [checks-test-layout](checks-test-layout.md) says.

## What it reads

It reads bun's JUnit report of its own run, which bun writes to a temporary directory, and `testSkips` in `package.json`.
It counts a run as `ci` when `CI` is set true, as GitHub Actions sets it, and as `local` otherwise.

## Arguments

It takes none.
A `-t` filter would report every test it leaves out as skipped, and a path filter would drop files a declaration names.
A narrowed run is therefore plain `bun test --randomize` with the arguments.

## Exit codes

| Code | When |
| --- | --- |
| 0 | every test that ran passed, and every skip is declared |
| 1 | a test failed, a skip is undeclared, or in a ci run a declaration is stale |
| 2 | `testSkips` does not parse, `CI` is set to something other than a boolean, or bun passed without writing its report |

## Sample output

```
checks-test: 1 skipped test(s) undeclared and 1 declaration(s) matching no skipped test in this ci run:
  tests/pricing.test.ts:12 pricing > rounds half to even: skipped with no declaration; run it, or declare it in package.json testSkips with its reason
  tests/e2e/docker.test.ts > images > builds the release image: declared, but no such test skipped; delete the declaration
```

A run with nothing skipped ends with:

```
checks-test: no test skipped
```

## Opting out

A test opts out of a run through its declaration in `testSkips`.
A repository that tracks TypeScript source runs `checks-test` as `scripts.test`, since [checks-test-layout](checks-test-layout.md) requires it.

## Related topics

- [checks-test-layout](checks-test-layout.md)
- [checks-flake](checks-flake.md)
