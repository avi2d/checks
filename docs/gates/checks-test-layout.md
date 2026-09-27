---
kind: reference
audience: consumers
---
# checks-test-layout

`checks-test-layout` is the gate that holds a repository's tests to one layout, which says where a test file goes and what it may import.

## What it checks

It fails unless the repository holds this shape, and names the file and the path to move it to when it does not.

- Every test file is `tests/<level>/**/*.test.ts` or `.tsx`, and the level is `unit`, `e2e`, `live` or `pixel`.
  A quarantined test keeps its level as `tests/quarantine/<level>/**/*.test.ts`.
  A `*.test.ts`, `*.spec.ts` or `*_test.ts` under `src/`, `test/`, `__tests__/`, the repository root or a directory under `tests/` that names no level fails.
  The path it names for the move is under `tests/unit/` unless the file already sits under a level.
- `tests/lib/**` holds helpers and `tests/fixtures/**` holds data, and neither may hold a test file.
  Under its level, a test may sit in groups nested as deep as it likes.
- `tests/live/**` holds tests that need a live machine, and `tests/pixel/**` holds tests that need a display.
  Bun ignores both directories in the default suite.
  A live tier with test files requires `test:live` set to `checks-test --tier=live`.
  A pixel tier with test files requires `test:pixel` set to `checks-test --tier=pixel`.
- A test runs in-process or in a process of its own.
  A test outside the `e2e`, `live` and `pixel` levels runs in-process, quarantined or not, so it may not import `node:child_process`, `net`, `http`, `https`, `http2`, `tls` or `dgram`.
  It may not import `$`, `spawn`, `spawnSync`, `connect`, `serve` or `listen` from `bun`, may not touch `Bun.$` or `Bun.spawn`, and may not call `fetch`.
  A test at the `e2e`, `live` or `pixel` level may do all of it, under `tests/quarantine/` as well.
  Helpers in `tests/lib/**` answer to the same rule, since an in-process test reaches them.
- `scripts.test` is exactly `checks-test`, which runs `bun test --randomize` as [checks-test](checks-test.md) says.
- `scripts.lint` runs this check, itself or through `checks-lint` called by its bare bin name.
- `bunfig.toml` carries every `[test]` key of the shipped preset with the same value.
  `[test].pathIgnorePatterns` is the preset's `["**/tests/quarantine/**", "**/tests/live/**", "**/tests/pixel/**", "repos/**"]`, which the check pins itself, so the kit's own repository, whose bunfig is the preset, cannot drift it either.
  The check also accepts the list without `repos/**`, so a repository that links no library under `repos/` may drop it.
  Other tables, and extra `[test]` keys, are the repository's own.

The in-process tests under `tests/unit/` are what a mutation run takes as its tests, and a runner names them by that path rather than by a list of paths to ignore.
`tests/e2e/**` is left out of a mutate scope by construction, because a subprocess kills both the speed and the coverage signal a mutant needs.

The preset also skips `tests/quarantine/**` and `repos/**` on a default run.
The `repos/**` entry keeps the suite from following the library links `checks-vendor` manages into trees whose tests are not this repository's.
A test that turns flaky moves there at its own level, so the suite stays trustworthy.
A flaky test under `tests/e2e/stack/` moves to the same path under `tests/quarantine/e2e/stack/`, where it may still spawn, and moves back once fixed.
A `quarantine` directory below a level is refused, since the preset's ignore does not reach it and the test would still run.
The flake still runs on demand:

```sh
bun test --path-ignore-patterns='' tests/quarantine
```

A test left there past 30 days fails [checks-quarantine-clock](checks-quarantine-clock.md).

## What it reads

It reads the working tree.
It scans the tracked and untracked files that `git ls-files --exclude-standard` reports, so `node_modules/` and every gitignored tree are out of reach, and a local run agrees with CI before `git add`.
It parses each test and helper with swc and reads import specifiers and identifier use, so a test that only carries `"node:child_process"` as a string is not a violation.
`tests/fixtures/**` is data and is not parsed.
It reads `package.json` for `scripts.test` and `scripts.lint`.
It also checks `test:live` and `test:pixel` when their directories contain test files, and compares `bunfig.toml` with the preset the installed kit ships.

## Arguments

```sh
checks-test-layout [<directory>]
```

It checks the directory it runs in, or the directory it is given.

## Exit codes

| Code | When |
| --- | --- |
| 0 | the repository holds the layout |
| 1 | a file breaks the layout |
| 2 | a test, a helper or `package.json` does not parse |

## Sample output

```
test-layout: 4 violation(s)
  src/a.test.ts: a test file must live at tests/<level>/**/*.test.ts, or tests/quarantine/<level>/**/*.test.ts while quarantined, with unit, e2e, live, or pixel as the level; move it to tests/unit/a.test.ts
  package.json: scripts.test must be exactly "checks-test", which runs bun test --randomize and judges its skips, found "bun test"
  package.json: scripts.lint must run the layout check: add "checks-lint"
  bunfig.toml: bunfig.toml is missing; bun has no bunfig extends, so copy node_modules/@avi2dg/checks/bunfig.toml
```

## When it runs

`checks-lint` runs it when the repository tracks TypeScript.
A repository without TypeScript needs neither the `checks-test` script nor `bunfig.toml`.

## Related topics

- [checks-test](checks-test.md)
- [checks-flake](checks-flake.md)
- [checks-mutation-compare](checks-mutation-compare.md)
- [checks-quarantine-clock](checks-quarantine-clock.md)
