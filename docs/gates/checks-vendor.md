# checks-vendor

`checks-vendor` pins each library `quality.json` declares to one shared read-only clone on the machine and links it under `repos/`.

## What it checks

Each entry under `sources.libraries` names an npm package, a git remote and a tag template holding `{version}`.
`checks-vendor` reads the installed version from `node_modules/<package>/package.json` and resolves the template to one tag.
It clones that tag once into a cache shared across repositories, records the landed commit beside the tree, strips every write bit and links `repos/<name>` to the tree.
The clone is staged beside its cache entry and moves into place only once it is recorded, checked and read only, so a concurrent or killed first run never leaves a half built tree there.
Every later run verifies the link rather than trusting it, and does so without contacting the remote.
It confirms the tree sits on the recorded commit.
It confirms the manifest inside the tree still names the installed version.
It confirms no write bit came back and no write landed outside the recorded commit.
It never follows a link inside the tree, so no mode outside the cache is touched.
Any failed confirmation fails the run.
A failed library drops its `repos/<name>` link, so a reader falls back to `node_modules/<package>` rather than a tree the run could not vouch for.
A missing tag, an unknown installed version or a manifest naming another version fails it too.
A tag moved upstream after the first fetch is not followed, since a cached tree stays on its recorded commit.
A deliberate move clears the cached directory with `chmod -R u+w <dir> && rm -rf <dir>` and runs `checks-vendor` again.
The cache lives at `~/.cache/avi2dg-checks/repos/<host>/<owner>/<repo>/<tag>/`.
A read through the link resolves outside the checkout, so a reader that must stay inside the tree falls back to `node_modules/<package>`.

## What it reads

It reads the working tree.
That is `quality.json`, `node_modules/<package>/package.json` for each declared library and the `repos/` links.
It reads the shared cache outside the checkout.
That is each tag tree, its recorded commit and its manifest.
It asks a remote which commit its tag lands on only when that tag is not cached yet.

## Arguments

```sh
checks-vendor
```

It takes no arguments, since `quality.json` names the libraries.

## Exit codes

| Code | When |
| --- | --- |
| 0 | every declared library links a verified tree, or its remote could not be reached for a first fetch |
| 1 | a tag is missing, a tree was written to, a record disagrees with its tree, a version disagrees or a link is blocked |
| 2 | `quality.json` does not decode, or arguments were passed |

## Sample output

```
checks-vendor: cloned effect@4.0.0-rc.115 from https://github.com/Effect-TS/effect.git and linked repos/effect
```

A fresh fetch reports the tag it cloned and the link it made.

```
checks-vendor: repos/effect still holds effect@4.0.0-rc.115, verified against its recorded commit
```

A later run reports the link it kept.

## Wiring

A consuming repository runs it from its `prepare` script, so every install pins and verifies the trees.

```json
{ "scripts": { "prepare": "checks-vendor" } }
```

An install offline still passes.
A cached tree verifies with no network, and a tag that is not cached yet warns, stays unlinked and leaves readers on `node_modules/<package>` until a later install can fetch it.

It ignores the links in `.gitignore` with `repos/*`, because `repos/*/` does not match a link.

```gitignore
repos/*
```

## Opting out

It runs only in a repository that declares `sources.libraries`.
A repository without that key reports nothing to pin and changes nothing.
A repository that declares no library needs no `prepare` entry for it.

## Related topics

- [The quality file](../configs/quality-file.md)
