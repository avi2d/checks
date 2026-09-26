---
kind: reference
audience: consumers
---
# checks-size-budget

`checks-size-budget` runs oxlint with the repository's own `.oxlintrc.json` at both ends of a commit range and refuses a size overrun that grew.

## What it checks

The size rules are oxlint's `max-lines`, `max-lines-per-function`, `max-statements`, `effect-channel/cognitive-complexity` and `max-depth`.
oxlint alone decides which files each rule covers and at what limit, through the severities, overrides and excludes in `.oxlintrc.json`.
A size rule at `error` is a hard limit, and `bun run lint` already fails every file over it.
A size rule at `warn` is existing debt, and this gate stops it from growing.

```json
{
  "plugins": ["typescript", "oxc", "eslint", "import"],
  "overrides": [
    { "files": ["src/**/*.ts"], "rules": { "max-lines": ["error", { "max": 400 }] } },
    { "files": ["src/legacy/**/*.ts"], "rules": { "max-lines": ["warn", { "max": 400 }] } },
    { "files": ["tests/**/*.ts"], "rules": { "max-lines": ["error", { "max": 600 }] } }
  ]
}
```

The kit's recommended limits are below:

<!-- generated size-limits: bun run build writes it from SIZE_RULES and SIZE_DEFAULTS in scripts/size-rules.ts and scripts/doc-blocks.ts -->

| Key | Limits | oxlint rule | Production | Tests |
| --- | --- | --- | --- | --- |
| `fileLines` | The most lines a file may hold, blank and comment lines counted | `max-lines` | 400 | 600 |
| `functionLines` | The most lines a function may span, blank and comment lines counted | `max-lines-per-function` | 100 | none |
| `statements` | The most statements a function may hold | `max-statements` | 30 | 50 |
| `complexity` | The highest cognitive complexity a function may reach, a switch counted once | `effect-channel/cognitive-complexity` | 15 | 15 |
| `depth` | The deepest a block may nest inside a function | `max-depth` | 4 | 4 |

<!-- end generated size-limits -->

The gate compares each changed file with the same file at the base commit, one size rule at a time, and never sums sites.
It fails when the head holds more sites over a rule than the base.
It also fails when a site runs further over than the site of the same function name at the base.
A whole file is one site, and sites of one name pair with the base in order of overrun.
Both ends are measured under the head's `.oxlintrc.json`, so a changed limit never reads as growth.
A new file starts from zero.
An unchanged overrun appears as advisory rather than failing the range.

## What it reads

The bin writes the tracked files of the head to a temporary directory, links the repository's `node_modules` beside them and runs oxlint there.
It writes the base versions of the changed files over a second copy of the head and runs oxlint on those files.
It never reads the working tree's file contents.

## Arguments

```sh
checks-size-budget <base-ref> <head-ref>
checks-size-budget <ref>
```

## Exit codes

| Code | Result |
| --- | --- |
| 0 | No measured overrun grew. |
| 1 | An overrun grew past its base value. |
| 2 | A config or ref is invalid, or oxlint cannot run. |

## Sample output

```
size-budget: 1 overrun(s) grew past the base in the files the range adds or changes:
  src/ledger.ts: max-lines over at 1 site(s), up from 0
```

## Opting out

When `.oxlintrc.json` turns on no size rule, oxlint reports no overrun and the gate passes.

## Related topics

- [Native settings](../configs/native-settings.md)
- [checks-repetition](checks-repetition.md)
