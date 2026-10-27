---
kind: reference
audience: consumers
---
# checks-release-preflight

`checks-release-preflight` fails the release workflow fast when the release cannot run.
It runs before the release step, so a release that cannot publish never builds, lints or tests first.

## What it checks

It reads the version `package.json` holds and the last `v*` tag.
It refuses when the last tag names another version, since an untagged bump means a release landed that nothing published.
It reads the release workflow its argument names.
When the workflow publishes to npm, it compares the repository `package.json` names with the repository the run is in.
It refuses when the two differ, since the trusted publisher npm holds matches the run by repository and workflow.
It refuses when the workflow grants no `id-token: write`, since the run then mints no OIDC token for the trusted publisher npm holds.
A workflow that publishes nothing to npm needs no trusted publisher, so that check passes it without reading the repository.
It reads whether the repository lets GitHub Actions create and approve pull requests.
It refuses when the setting is off, since the daily release cannot open its release pull request.

## What it reads

It reads `package.json` and `.github/workflows/<workflow>` from the checkout.
It reads the `v*` tags from the checkout, so the checkout fetches the whole history.
It reads the run repository from `GITHUB_REPOSITORY`.
It calls the GitHub API through `gh api`, which takes the repository from the checkout remote and the token from `GH_TOKEN`.
The token needs `contents: read` and `actions: read`.

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

A release that agrees on every check prints three lines.

```text
release-preflight: package.json holds 0.4.0, which matches v0.4.0
release-preflight: npm's trusted publisher for @acme/widget matches the run in acme/widget
release-preflight: the repository lets GitHub Actions create and approve the release pull request
```

A manifest bumped past the last tag refuses with the fix.

```text
checks-release-preflight: package.json holds 0.7.0, but the last release tag is v0.6.0, so v0.7.0 is untagged; rerun the release that bumped it, whose refusal says what to fix, or return package.json to 0.6.0
```

A run in another repository than the manifest names refuses with both sides.

```text
checks-release-preflight: package.json names the repository other/widget, but the run is in acme/widget, so npm's trusted publisher for @acme/widget matches no run here; point repository.url at acme/widget, or move the trusted publisher on npm to other/widget and release.yml
```

A repository that forbids release pull requests refuses with the command that allows them.

```text
checks-release-preflight: the repository forbids GitHub Actions from creating and approving pull requests, so the daily release cannot open its release pull request; allow it with `gh api --method PUT repos/acme/widget/actions/permissions/workflow -F can_approve_pull_request_reviews=true`
```

## When it runs

The `preflight` job of the release workflow runs it, and the job that publishes needs that job.
A release that cannot run then fails before the build, the lint, the typecheck and the suite.

## Related topics

- [checks-release-notes](checks-release-notes.md)
- [checks-release-publish](checks-release-publish.md)
- [checks-release-push](checks-release-push.md)
- [checks-release-pr](checks-release-pr.md)
- [checks-release-tag](checks-release-tag.md)
