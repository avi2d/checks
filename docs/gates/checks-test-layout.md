# checks-test-layout

`checks-test-layout` is the gate that holds a repository's tests to one layout, and a reader looks it up to learn where a test file goes and what it may import.

## What it checks

It fails unless the repository holds this shape, and names the file and the path to move it to when it does not.

- Every test file is `tests/**/*.test.ts` or `.tsx`.
  A `*.test.ts`, `*.spec.ts` or `*_test.ts` under `src/`, `test/`, `__tests__/` or the repository root fails.
- `tests/lib/**` holds helpers and `tests/fixtures/**` holds data, and neither may hold a test file.
  Every other directory directly under `tests/` is a test group and may nest as deep as it likes.
- A test runs at one of two levels.
  A test outside `tests/e2e/` runs in-process, so it may not import `node:child_process`, `net`, `http`, `https`, `http2`, `tls` or `dgram`.
  It may not import `$`, `spawn`, `spawnSync`, `connect`, `serve` or `listen` from `bun`, may not touch `Bun.$` or `Bun.spawn`, and may not call `fetch`.
  A test inside `tests/e2e/` may do all of it.
  Helpers in `tests/lib/**` answer to the same rule, since an in-process test reaches them.
- `scripts.test` is exactly `checks-test`, which runs `bun test --randomize` as [checks-test](checks-test.md) says.
- `scripts.lint` runs this check, itself or through `checks-lint` called by its bare bin name.
- `bunfig.toml` carries every `[test]` key of the shipped preset with the same value.
  `[test].pathIgnorePatterns` is always `["**/tests/quarantine/**"]`, which the check pins itself, so the kit's own repository, whose bunfig is the preset, cannot drift it either.
  A repository whose `quality.json` declares `sources.libraries` pins `["**/tests/quarantine/**", "repos/**"]` instead, as the preset does.
  Other tables, and extra `[test]` keys, are the repository's own.

The in-process half is what a mutation run can mutate.
`tests/e2e/**` is left out of a mutate scope by construction, because a subprocess kills both the speed and the coverage signal a mutant needs.

The preset also skips `tests/quarantine/**` and `repos/**` on a default run.
The `repos/**` entry keeps the suite from following the library links `checks-vendor` manages into trees whose tests are not this repository's.
A test that turns flaky moves there, so the suite stays trustworthy, and the flake still runs on demand:

```sh
bun test --path-ignore-patterns='' tests/quarantine
```

## What it reads

It reads the working tree.
It scans the tracked and untracked files that `git ls-files --exclude-standard` reports, so `node_modules/` and every gitignored tree are out of reach, and a local run agrees with CI before `git add`.
It parses each test and helper with swc and reads import specifiers and identifier use, so a test that only carries `"node:child_process"` as a string is not a violation.
`tests/fixtures/**` is data and is not parsed.
It reads `package.json` for `scripts.test` and `scripts.lint`, and compares `bunfig.toml` with the preset the installed kit ships.
It reads `quality.json` for `sources.libraries`, which decides whether `repos/**` is pinned.

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
  src/a.test.ts: a test file must live at tests/**/*.test.ts; move it to tests/a.test.ts
  package.json: scripts.test must be exactly "checks-test", which runs bun test --randomize and judges its skips, found "bun test"
  package.json: scripts.lint must run the layout check: add "checks-lint"
  bunfig.toml: bunfig.toml is missing; bun has no bunfig extends, so copy node_modules/@avi2dg/checks/bunfig.toml with [test].pathIgnorePatterns set to ["**/tests/quarantine/**"]
```

## Opting out

A repository that tracks no `.ts` or `.tsx` file leaves it out of `gates.lint`, as [Gate selection](checks-lint.md#gate-selection) says, and then needs no `checks-test` script and no `bunfig.toml`.
A repository that tracks one keeps it.

## Related topics

- [checks-test](checks-test.md)
- [checks-flake](checks-flake.md)
- [checks-mutation-compare](checks-mutation-compare.md)
