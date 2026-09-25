# checks-vendor

`checks-vendor` pins each library `quality.json` declares to one shared read-only clone on the machine and links it under `repos/`.

## What it checks

Each entry under `sources.libraries` names an npm package, a git remote and a tag template holding `{version}`.
`checks-vendor` reads the installed version from `node_modules/<package>/package.json` and resolves the template to one tag.
It clones that tag once into a cache shared across repositories, records the landed commit beside the tree, strips every write bit and links `repos/<name>` to the tree.
Every later run verifies the link rather than trusting it.
It confirms the remote tag still lands on the recorded commit.
It confirms the tree sits on that commit.
It confirms the manifest inside the tree still names the installed version.
It confirms no write bit came back and no write landed outside the recorded commit.
Any failed confirmation fails the run.
A missing tag, an unknown installed version or a manifest naming another version fails it too.
A moved tag fails it rather than following the move.
A deliberate move removes the cached directory and runs `checks-vendor` again.
The cache lives at `~/.cache/avi2dg-checks/repos/<host>/<owner>/<repo>/<tag>/`.
It lives at `CHECKS_VENDOR_CACHE/repos/...` instead when that variable holds a directory.
A read through the link resolves outside the checkout, so a reader that must stay inside the tree falls back to `node_modules/<package>`.

## What it reads

It reads the working tree.
That is `quality.json`, `node_modules/<package>/package.json` for each declared library and the `repos/` links.
It reads the shared cache outside the checkout.
That is each tag tree, its recorded commit and its manifest.
It asks each remote which commit its tag lands on.

## Arguments

```sh
checks-vendor
```

It takes no arguments, since `quality.json` names the libraries.

## Exit codes

| Code | When |
| --- | --- |
| 0 | every declared library links a verified tree |
| 1 | a tag moved, a tree was written to, a version disagrees or a link is blocked |
| 2 | `quality.json` does not decode, or arguments were passed |

## Sample output

```
checks-vendor: cloned effect@4.0.0-rc.115 from https://github.com/Effect-TS/effect.git and linked repos/effect
```

A fresh fetch reports the tag it cloned and the link it made.

```
checks-vendor: repos/effect still holds effect@4.0.0-rc.115, verified against https://github.com/Effect-TS/effect.git
```

A later run reports the link it kept.

## Opting out

It runs only in a repository that declares `sources.libraries`.
A repository without that key reports nothing to pin and changes nothing.
A repository that declares no library needs no `prepare` entry for it.

## Related topics

- [The quality file](../configs/quality-file.md)
