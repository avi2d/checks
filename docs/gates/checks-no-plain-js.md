---
kind: reference
audience: consumers
---
# checks-no-plain-js

`checks-no-plain-js` is the gate that refuses a plain JavaScript source file in a repository that tracks TypeScript.

## What it checks

It fails on every `.js` or `.mjs` file in the working tree that is neither generated output, a vendored tree, a served asset, fixture data, nor a tool entry its loader cannot read as TypeScript.
Each line names the file and tells its writer to convert it to TypeScript.
`dist/` holds the committed build output, so the check passes over it.
`dependency-cruiser.config.js` at the repository root is written by `bun run build` from the TypeScript builder, so the check passes over that one path.
`node_modules/` and `repos/` hold installed and vendored trees, so the check passes over both.
`public/` holds assets the server sends verbatim, which no compiler reads, so the check passes over it.
`tests/fixtures/` holds data the suite never parses, so the check passes over it.
Stryker loads its config only as JSON or JavaScript, so the check passes over a config file carrying a Stryker config name, such as `stryker.conf.mjs`.
The Stryker preset ships as `stryker.preset.js` under its documented import path, so the check passes over that name.
A config file its tool loads as TypeScript fails, such as a commitlint config or a dependency-cruiser config in JavaScript, since each loader reads TypeScript too.

## What it reads

It reads the working tree.
It scans the tracked and untracked files that `git ls-files --exclude-standard` reports, so `node_modules/` and every gitignored tree are out of reach, and a local run agrees with CI before `git add`.

## Arguments

```sh
checks-no-plain-js [<directory>]
```

It checks the directory it runs in, or the directory it is given.

## Exit codes

| Code | When |
| --- | --- |
| 0 | the working tree holds no plain JavaScript source |
| 1 | a file in the working tree is plain JavaScript |
| 2 | git does not list the working tree |

## Sample output

```
no-plain-js: 2 violation(s)
  src/legacy.js: plain JavaScript source in a TypeScript repository; convert it to TypeScript
  tools/build.mjs: plain JavaScript source in a TypeScript repository; convert it to TypeScript
```

## When it runs

`checks-lint` runs it when the repository tracks TypeScript.

## Related topics

- [checks-lint](checks-lint.md)
- [checks-test-layout](checks-test-layout.md)
- [checks-unused](checks-unused.md)
