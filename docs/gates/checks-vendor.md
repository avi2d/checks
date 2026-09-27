---
kind: reference
audience: consumers
---
# checks-vendor

`checks-vendor` pins each library its arguments name to one shared read-only clone and links it under `repos/`.

## What it checks

Each `--library` names an npm package, a git remote and a tag template holding `{version}`.
Its name is the link under `repos/`, and its optional `--path` is the manifest inside the clone that holds the version, `package.json` when absent.
`checks-vendor` reads the installed version from `node_modules/<package>/package.json` and resolves the template to one tag.
It clones that tag once into a cache shared across repositories, records the landed commit in `<tag>.commit` beside the tree, strips every write bit and links `repos/<name>` to the tree.
The clone is staged beside its cache entry and moves into place only once it is recorded, checked and read only, so a concurrent or killed first run never leaves a half built tree there.
Every later run verifies the link rather than trusting it, and does so without contacting the remote.
It confirms the tree sits on the recorded commit.
It confirms the manifest inside the tree still names the installed version.
It confirms no write bit is left once it has frozen the tree and no write landed outside the recorded commit.
It never follows a link inside the tree, so no mode outside the cache is touched.
A tool that clears the read only mode of `repos/<name>` changes the tree's top directory through the link, as the GitHub Actions runner does when it empties `$RUNNER_TEMP`.
A run that finds an owner write bit strips it from the tree again, then confirms no write landed outside the recorded commit.
A group or other write bit is never stripped, and fails the run before it reads the tree's status.
Any other failed confirmation fails the run, and so does a write the tree still holds once it is read only again.
A failed library drops its `repos/<name>` link, so a reader falls back to `node_modules/<package>` rather than a tree the run could not vouch for.
A missing tag, an unknown installed version or a manifest naming another version fails it too.
A tag moved upstream after the first fetch is not followed, since a cached tree stays on its recorded commit.
Clearing the tree with `chmod -R u+w <dir> && rm -rf <dir>` keeps the record, so the next fetch fails when the tag now lands elsewhere.
A deliberate move also deletes `<tag>.commit` by hand before `checks-vendor` runs again.
The cache lives at `~/.cache/avi2dg-checks/repos/<host>/<owner>/<repo>/<tag>/`.
A read through the link resolves outside the checkout, so a reader that must stay inside the tree falls back to `node_modules/<package>`.

## What it reads

It reads the working tree.
That is `node_modules/<package>/package.json` for each named library and the `repos/` links.
It reads the shared cache outside the checkout.
That is each tag tree, its recorded commit and its manifest.
It contacts a remote only when a tag is not cached yet, to confirm the tag exists and to clone it.

## Arguments

```sh
checks-vendor [--library <name> --package <package> --repository <remote> --tag <template> [--path <manifest>]]...
```

Each `--library` opens one library, and the flags after it up to the next `--library` describe it.
`--package`, `--repository` and `--tag` are required, and `--path` is optional.
A name is lowercase words joined by hyphens, and no two libraries share one.
With no arguments it pins nothing.

## Exit codes

| Code | When |
| --- | --- |
| 0 | every named library links a verified tree, its remote could not be reached for a first fetch, or no git checkout holds the run |
| 1 | a tag is missing or lands elsewhere than its record, an installed version is unknown, a tree was written to, a record disagrees with its tree, a version disagrees or a link is blocked |
| 2 | an argument is unknown, missing, repeated or malformed, or `HOME` is unset |

## Sample output

```
checks-vendor: cloned effect@4.0.0-rc.115 from https://github.com/Effect-TS/effect.git and linked repos/effect
```

A fresh fetch reports the tag it cloned and the link it made.

```
checks-vendor: repos/effect still holds effect@4.0.0-rc.115, verified against its recorded commit
```

A later run reports the link it kept.

```
checks-vendor: found 1 path writable by its owner, starting with /home/runner/.cache/avi2dg-checks/repos/github.com/Effect-TS/effect/effect@4.0.0-rc.115, and froze the tree again, so repos/effect still holds effect@4.0.0-rc.115, verified against its recorded commit
```

A run that found an owner write bit reports how many paths carried one and the first of them.

## Wiring

A consuming repository runs it from its `prepare` script, so every install pins and verifies the trees.

```json
{ "scripts": { "prepare": "checks-vendor --library effect --package effect --repository https://github.com/Effect-TS/effect.git --tag 'effect@{version}' --path packages/effect/package.json" } }
```

An install offline still passes.
A cached tree verifies with no network, and a tag that is not cached yet warns, stays unlinked and leaves readers on `node_modules/<package>` until a later install can fetch it.
An install outside a git checkout, or with no `git` on the path, warns once, links nothing and passes too.

It ignores the links in `.gitignore` with `repos/*`, because `repos/*/` does not match a link.

```gitignore
repos/*
```

TypeScript does not read `.gitignore`, and its default `include` follows the links into each library tree.
A consumer whose `tsconfig.json` has no explicit `include` keeps the trees out with an `exclude` entry.

```json
{ "exclude": ["node_modules", "repos"] }
```

## When it runs

The repository's `prepare` script runs it, as [Wiring](#wiring) shows.
It pins only the libraries its arguments name, and a run with no arguments changes nothing.
A repository that pins no library needs no `prepare` entry for it.

## Related topics

- [Native settings](../configs/native-settings.md)
