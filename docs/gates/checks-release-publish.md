---
kind: reference
audience: consumers
---
# checks-release-publish

`checks-release-publish` publishes the version `package.json` holds to npm, unless npm already holds it or a newer version.

## What it checks

It reads the `latest` dist-tag of the package from npm.
It runs `npm publish` when npm holds no version of the package yet, or when the version is above `latest`.
It publishes nothing and ends cleanly when `latest` is the version, so a rerun of a release that published passes.
It publishes nothing and ends cleanly when `latest` is above the version.
The release workflow refuses a tag off `main`, so the newer version already carries every change of the older one.
When `npm publish` fails, it reads `latest` again.
A newer version that published while it ran ends it cleanly as well, and any other failure fails it.

Two uploads that overlap can still leave `latest` on the older version, since the order check runs before either upload completes.
`checks-release-push` holds its concurrency group until the release workflow it dispatched finishes for that reason, so releases it cuts publish one at a time, while a release workflow dispatched or rerun by hand relies on this bin alone.

## What it reads

It reads `name` and `version` from `package.json` in the working directory.
It reads `latest` with `npm view <name> dist-tags --json`, and takes npm's `E404` answer for a package npm does not hold yet.
`npm publish` takes its registry and credentials from the workflow, as trusted publishing sets them.

## Arguments

```sh
checks-release-publish
```

It takes no arguments.

## Exit codes

| Code | When |
| --- | --- |
| 0 | the version published, npm already holds it, or npm holds a newer version |
| 2 | the arguments do not parse, `package.json` or npm's answer does not parse, or npm refuses the publish for a reason other than a newer version |

## Sample output

A release that runs after a newer one published prints one line:

```
release-publish: npm already holds @acme/widget@0.4.1, which carries every change in 0.4.0, so 0.4.0 stays off npm
```

## When it runs

The release workflow of a package published to npm runs it in place of `npm publish`, as [checks-release-notes](checks-release-notes.md#release-workflow) shows.
A repository that never publishes to npm does not need it.

## Related topics

- [checks-release-notes](checks-release-notes.md)
- [checks-release-push](checks-release-push.md)
