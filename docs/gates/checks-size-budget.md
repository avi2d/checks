---
kind: reference
audience: consumers
---
# checks-size-budget

`checks-size-budget` measures the oxlint size rules declared in `.oxlintrc.json` against production and test files in a commit range.

## What it checks

A size override is an override in `.oxlintrc.json` that sets any of oxlint's `max-lines`, `max-lines-per-function`, `max-statements`, `effect-channel/cognitive-complexity` and `max-depth` rules.
Each size override holds its own `files` to its own limits, and a later override wins for a file two of them match, as oxlint merges them.
Size rules at the top level hold every file no override changes.
A glob without a slash matches at any depth, as oxlint reads it.
An override whose globs all name test files, under `tests/` or ending in `.test.ts` or `.spec.ts`, is a test override, and any other is a production override.

```json
{
  "plugins": ["typescript", "oxc", "eslint", "import"],
  "overrides": [
    { "files": ["src/**/*.ts"], "rules": { "max-lines": ["error", { "max": 400 }] } },
    { "files": ["tests/**/*.ts"], "rules": { "max-lines": ["error", { "max": 600 }] } }
  ]
}
```

Size rules without a production override exit 2, since an empty measurement cannot prove a budget.
An override that mixes test and production globs exits 2, and so does a production glob that matches no tracked file.
The kit's recommended limits are below, and only rules declared in `.oxlintrc.json` apply:

<!-- generated size-limits: bun run build writes it from SIZE_RULES and SIZE_DEFAULTS in scripts/size-rules.ts and scripts/doc-blocks.ts -->

| Key | Limits | oxlint rule | Production | Tests |
| --- | --- | --- | --- | --- |
| `fileLines` | The most lines a file may hold, blank and comment lines counted | `max-lines` | 400 | 600 |
| `functionLines` | The most lines a function may span, blank and comment lines counted | `max-lines-per-function` | 100 | none |
| `statements` | The most statements a function may hold | `max-statements` | 30 | 50 |
| `complexity` | The highest cognitive complexity a function may reach, a switch counted once | `effect-channel/cognitive-complexity` | 15 | 15 |
| `depth` | The deepest a block may nest inside a function | `max-depth` | 4 | 4 |

<!-- end generated size-limits -->

The gate compares the total overrun of each changed file a size override lists at the head with the base commit.
A new file starts from zero.
An unchanged overrun appears as advisory rather than failing the range.
Normal oxlint runs enforce the same native rules on the whole working tree.
Declaration files are excluded.

## What it reads

The bin reads the native size overrides from `.oxlintrc.json` and the files at both ends of the range.
It uses oxlint to measure each revision without reading the working tree's file contents.

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
size-budget: 1 overrun(s) grew past the base in the production and test files the range adds or changes:
  src/ledger.ts: max-lines over by 10 in total, up from 0
```

## Opting out

When `.oxlintrc.json` names no size rule, the gate reports that no size budget was declared.

## Related topics

- [Native settings](../configs/native-settings.md)
- [checks-repetition](checks-repetition.md)
