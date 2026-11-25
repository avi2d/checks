---
kind: reference
audience: consumers
---
# checks-release-publish

`checks-release-publish` publishes the version `package.json` holds to npm, unless npm already holds it or a newer version.

## What it checks

It reads the `latest` dist-tag of the package from npm.
When npm holds no version of the package yet, or when the version is above `latest`, it looks up the exact version before it runs `npm publish`.
It skips the publish when npm already holds that version.
It publishes nothing and ends cleanly when `latest` is the version, so a rerun of a release that published passes.
It publishes nothing and ends cleanly when `latest` is above the version.
The release workflow refuses a tag off `main`, so the newer version already carries every change of the older one.
After a publish refusal, it reads `latest` again and ends cleanly if npm holds this version or a newer version.
Otherwise, either refusal starts a shasum check for this version:

- An `E409` refusal to overwrite a staged version.
- An `E403` refusal to overwrite a published version.

It reads that version's `dist.shasum` up to ten times, with ten seconds between attempts.
The check succeeds only when the published shasum matches the shasum in the publish output.
A different shasum, a version that does not appear, or any other publish failure without the same or a newer version fails it.

Two uploads that overlap can still leave `latest` on the older version, since the order check runs before either upload completes.
The kit cuts one release at a time through its single release pull request, but a release pull request that merges while an earlier release still publishes overlaps too, as does a release workflow dispatched or rerun by hand, so each relies on this bin alone.
If `latest` lands on the older version, `npm dist-tag add <package>@<newer version> latest` repairs it.

## What it reads

It reads `name` and `version` from `package.json` in the working directory.
It reads `latest` with `npm view <name> dist-tags --json`, and takes npm's `E404` answer for a package npm does not hold yet.
Before publishing, it reads `npm view <name>@<version> dist.shasum --json`, and takes `E404` as a version not yet visible.
The same command checks the shasum after an `E409` staged-version refusal or an `E403` published-version refusal.
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
| 2 | the arguments do not parse, `package.json` or npm's answer does not parse, or npm refuses the publish without the same or a newer version or a matching tarball |

## Sample output

A release that runs after a newer one published prints one line:

```
release-publish: npm already holds @acme/widget@0.4.1, which carries every change in 0.4.0, so 0.4.0 stays off npm
```

## When it runs

The release workflow of a package published to npm runs it in place of `npm publish`, as [checks-release-notes](checks-release-notes.md#release-workflow) shows.
Without release checks, on a composed `ci.yml` the release pull request skips every job but `changes`, and `checks` passes those skips.
So the release pull request runs no test.
A code repository whose `package.json` is not private holds a `suite` job in `main.yml`.
Its publish run runs the full suite once before the tag and the publish.
The tag publishes code the pull requests into `main` tested, since the required checks of the release pull request already passed on that tree, and the release commit adds only the version, the changelog, each public workspace version and its `bun.lock` entry where the caller publishes workspaces.
A repository that never publishes to npm does not need it.

## Related topics

- [checks-release-notes](checks-release-notes.md)
