---
kind: reference
audience: consumers
---
# checks-css-size

`checks-css-size` is the gate that holds each tracked stylesheet to 400 lines, the kit's own `max-lines` for code files.

## What it checks

It fails on every `*.css` file in the working tree that holds more than 400 lines.
It counts every line, blank lines and comments included, the way `max-lines` counts code with blank lines and comments kept.
Each line names the file and its line count, and tells its writer to split the stylesheet into smaller files.

## What it reads

It reads the working tree.
It scans the tracked and untracked files that `git ls-files --cached --others --exclude-standard` reports.
Ignore rules leave out untracked files only, so an untracked `node_modules/` is out of reach while a tracked stylesheet under an ignored directory is still measured.
A local run agrees with CI before `git add`.

## Arguments

```sh
checks-css-size [<directory>]
```

It checks the directory it runs in, or the directory it is given.

## Exit codes

| Code | When |
| --- | --- |
| 0 | every stylesheet holds 400 lines or fewer |
| 1 | a stylesheet holds more than 400 lines |
| 2 | git does not list the working tree, or a listed stylesheet cannot be read |

## Sample output

```
css-size: 1 violation(s)
  src/styles.css: 1901 lines, over the 400-line budget; split the stylesheet into smaller files
```

## When it runs

`checks-lint` runs it when the repository tracks a `*.css` file.

## Related topics

- [checks-frontend-syntax](checks-frontend-syntax.md)
- [checks-lint](checks-lint.md)
- [checks-repetition](checks-repetition.md)
