---
kind: reference
audience: consumers
---
# checks-workflows

`checks-workflows` holds a repository's workflow files to the one set of short callers its kind takes, and `--write` writes that set.

## What it checks

Every workflow file in the set is a short caller of one shared workflow in `avi2d/workflows`, so every step lives there once.
A repository with a workflow file that calls `site-ci.yml`, `site-main.yml`, `site-production.yml` or `preview-remove.yml` from `avi2d/workflows` is a site.
Any other repository is a code repository, and `package.json` decides neither kind.

Each site caller of those four shared workflows passes the three site names as inputs:

```yaml
    with:
      pages: "acme"
      domain: "acme.example"
      production: "acme/acme.example"
```

`pages` is the Cloudflare Pages project the previews and the staging site go to.
`domain` is the address the live site answers on.
`production` is the repository the live site publishes from, as `owner/name`.
The set takes the three names from the site callers the repository holds, so every site caller passes the same three.

A site takes these files under `.github/workflows/`:

| File | Event | Calls | Passes |
| --- | --- | --- | --- |
| `ci.yml` | a pull request opened, pushed to, reopened or marked ready for review, and `workflow_dispatch` | `site-ci.yml@v3` | the site names, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |
| `pr-title.yml` | a pull request title edit | `pr-title.yml@v3` | no input and no secret |
| `preview-close.yml` | a pull request closed | `preview-remove.yml@v3` | the site names, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |
| `main.yml` | a push to `main` | `site-main.yml@v3` | the site names, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |
| `release.yml` | `workflow_dispatch` | `release-pr.yml@v3` | no input and no secret |
| `production.yml` | `workflow_dispatch` | `site-production.yml@v3` | the site names, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `PRODUCTION_DEPLOY_KEY` |

A code repository takes these files:

| File | Event | Calls |
| --- | --- | --- |
| `ci.yml` | a pull request opened, pushed to, reopened or marked ready for review, and `workflow_dispatch` | `ci.yml@v3` |
| `pr-title.yml` | a pull request title edit | `pr-title.yml@v3` |
| `main.yml` | a push to `main` | `release-main.yml@v3` |
| `release.yml` | `workflow_dispatch` | `release-pr.yml@v3` |

The `ci.yml` caller runs one run per pull request and cancels the run a newer push replaces.
Each caller grants exactly the permissions its shared job declares.
Each caller passes, by name, exactly the secrets its shared workflow declares under `workflow_call`, each as `NAME: ${{ secrets.NAME }}`.
A code caller passes no secret, since its shared workflow declares none.
GitHub passes `secrets: inherit` only to a workflow in the same organization or enterprise, so a caller that holds it differs from the set.
The release, site main and production callers hold no concurrency group, since their shared jobs hold their own.
The code main caller holds group `main` without cancellation, since `release-main.yml` holds no group.
The files a code repository takes are byte-identical in every code repository.
The files a site takes differ between sites only in the three names they pass.
`pr-title.yml` and `release.yml` are the same in both kinds.

`pr-text.yml` stays as it is in both kinds.
It runs on `pull_request_target` and comment events, so no `ci.yml` caller replaces it.
`checks-workflows` never compares it, `--write` neither writes nor deletes it, and it is no extra.
A by-hand caller may be absent, but a present one holds exactly its caller form, which starts only on `workflow_dispatch`.
A site may hold `advisories.yml`.
A code repository may hold `advisories.yml`, `mutation.yml` and `flake.yml`, and its `mutation.yml` is the caller [checks-setup](checks-setup.md) writes.

It fails when a file of the set is missing or differs by a byte, or when a workflow file outside the set appears.
In a site it also fails when the site callers miss a name or pass two values of one.
The message names the callers or the flags that fix it.
Each difference names the file, and each changed line names what the file holds and what the caller holds.
The `avi2d/workflows` repository holds the shared workflows, so there it passes and keeps its own files.

## What it reads

It reads the `.yml` and `.yaml` files under `.github/workflows/` from the repository root.
It names the repository by `GITHUB_REPOSITORY`, or by the `origin` remote outside CI.

## Arguments

```sh
checks-workflows
checks-workflows --write
checks-workflows --write --pages acme --domain acme.example --production acme/acme.example
```

With `--write` it writes every file of the set, rewrites a present by-hand caller to its caller form, and deletes every other workflow file except `pr-text.yml`.
A rewrite of a site keeps the three names its callers pass.
`--pages`, `--domain` and `--production` name a site with no site caller yet, and each replaces the name the callers pass.
A site write that lacks one of the three names, passes two values of one, or names one that does not parse writes nothing and names the fix.

## Exit codes

| Code | When |
| --- | --- |
| 0 | the workflow files are the set, or `--write` wrote it |
| 1 | a file of the set is missing or differs, another workflow file appears, or the site callers pass none, two values or an unparsable value of a name |
| 2 | the arguments do not parse, a workflow file cannot be read, or a site write lacks one of the three names, passes two values of one, or names one that does not parse |

## Sample output

```
workflows: .github/workflows differs from the code set in 2 file(s):
  .github/workflows/ci.yml: differs from the caller checks-workflows writes
    line 10: holds "  cancel-in-progress: false", the caller holds "  cancel-in-progress: true"
  .github/workflows/pages.yml: no workflow of the set, so delete it
  run checks-workflows --write to write the set
```

## When it runs

The first step of the `checks` job each shared `ci` workflow runs is `bunx checks-workflows`, so a pull request that edits a caller or adds a workflow file fails.
[checks-ci-wiring](checks-ci-wiring.md) accepts the set as running every gate it requires, since the shared workflows run them.

## Related topics

- [checks-ci-wiring](checks-ci-wiring.md)
- [checks-release-tag](checks-release-tag.md)
- [checks-production-gate](checks-production-gate.md)
