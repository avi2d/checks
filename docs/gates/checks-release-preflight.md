---
kind: reference
audience: consumers
---
# checks-release-preflight

`checks-release-preflight` fails a release fast when local checks rule it out.
A version the last tag does not name and a run missing the trusted publisher prerequisites fail before the build.
A wrong trusted publisher setting on npm itself surfaces only at the publish step, through the publish refusal.

## What it checks

It reads the version `package.json` holds and the last `v*` tag.
It refuses when the last tag names another version, since an untagged bump means a release landed that nothing published.
It reads the release workflow its argument names.
A workflow that publishes nothing to npm needs no trusted publisher, so that check passes it without reading the repository.
Only a step whose run command invokes the publish counts as publishing.
A comment, a job name or any other text that names the publish never counts.
When the workflow publishes to npm, it compares the repository `package.json` names with the repository the run is in.
It refuses when the two differ, since the run then cannot present the trusted publisher npm holds.
It refuses when a publishing job holds no `id-token: write`, since the run then mints no OIDC token for the trusted publisher npm holds.
A job with its own permissions replaces the workflow permissions, so a workflow grant alone never passes a publishing job that lists its own permissions without the token, and a grant on another job never passes the publishing job.
The bin checks these prerequisites from local files only.
The trusted publisher setting itself cannot be verified without an npm credential, so a wrong setting surfaces at the publish step through the publish refusal.

## What it reads

It reads `package.json` and `.github/workflows/<workflow>` from the checkout.
It reads the `v*` tags from the checkout, so the checkout fetches the whole history.
It reads the run repository from `GITHUB_REPOSITORY`.
It makes no network call and takes no token.

## Arguments

```sh
checks-release-preflight <workflow>
```

The argument names the release workflow file under `.github/workflows/`, such as `release.yml`.

## Exit codes

| Code | Result |
| --- | --- |
| 0 | Every check passes. |
| 2 | The arguments do not parse, a check refuses the release, or a read fails. |

## Sample output

A release that agrees on every check prints two lines.

```text
release-preflight: package.json holds 0.4.0, which matches v0.4.0
release-preflight: package.json names acme/widget and release.yml grants the publishing job id-token: write, so the run holds the prerequisites for npm's trusted publisher for @acme/widget
```

A manifest bumped past the last tag refuses with the fix.

```text
checks-release-preflight: package.json holds 0.7.0, but the last release tag is v0.6.0, so v0.7.0 is untagged; rerun the release that bumped it, whose refusal says what to fix, or return package.json to 0.6.0
```

A run in another repository than the manifest names refuses with both sides.

```text
checks-release-preflight: package.json names the repository other/widget, but the run is in acme/widget, so the run cannot present npm's trusted publisher for @acme/widget; point repository.url at acme/widget, or move the trusted publisher on npm to other/widget and release.yml
```

A publishing job with no token refuses with where to grant it.

```text
checks-release-preflight: .github/workflows/release.yml grants the publishing job no id-token: write, so the run mints no OIDC token for npm's trusted publisher; grant id-token: write where the release job runs
```

## When it runs

The release planning boundary runs it before `checks-release-pr` plans and before `checks-release-push` plans a new release, and the `preflight` job of the release workflow keeps it as the prerequisite of the job that publishes.
A checkout whose `HEAD` already holds the release commit skips it, so `checks-release-push` recovers the missing tag.
A version the last tag does not name and a run missing the trusted publisher prerequisites then fail before the build, the lint, the typecheck and the suite.
A wrong trusted publisher setting on npm itself surfaces only at the publish step, through the publish refusal.

## Operator check

No endpoint the release token may read exposes the approval setting, so the bin never checks it.
Turn on **Allow GitHub Actions to create and approve pull requests** under the repository Actions settings before the daily release plans.
`checks-release-pr` fails while opening the pull request when the setting is off.

## Related topics

- [checks-release-notes](checks-release-notes.md)
- [checks-release-publish](checks-release-publish.md)
- [checks-release-push](checks-release-push.md)
- [checks-release-pr](checks-release-pr.md)
- [checks-release-tag](checks-release-tag.md)
