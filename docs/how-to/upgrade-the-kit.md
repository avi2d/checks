---
kind: how-to
audience: consumers
---
# Upgrade the kit

A repository owner follows these steps to move a repository the kit holds to a newer release.

## Before you begin

- A repository set up as [Set up a repository](set-up-a-repository.md) says.

## Upgrade

To move a repository to a newer release of the kit:

1. Rerun the [install line](../../README.md#install), which moves the kit to its newest release.
   A repository that lists a required peer explicitly also reruns the upgrade line below.
   The upgrade line keeps each declaration the repository imports.
   The upgrade line writes the lockfile, so the checks below run on the new pins.

   <!-- generated install: bun run build writes it from package.json and scripts/doc-blocks.ts -->

   ```sh
   bun add -d @effect/tsgo@0.45.0 @swc/core@1.16.2 dependency-cruiser@18.4.0 effect@4.0.0 jscpd@5.3.2 oxlint@1.83.0 oxlint-tsgolint@7.0.2002 typescript@7.0.2
   ```

   <!-- end generated install -->

   A repository that opted in to `checks-browser`, `checks-frontend-syntax` or `checks-copy` also reruns the `bun add` line on its page.
1. Run `bun run build`, whose `checks-effect-scope` rewrites the Effect override and the kit's severities in `tsconfig.json` when a release changes them.
   A severity key the release drops stays in `tsconfig.json` until the repository removes it.
1. Copy `node_modules/@avi2dg/checks/bunfig.toml` over `bunfig.toml` again, since `checks-test-layout` compares the copy with the installed preset.
1. Run `bun run lint`, `bun run typecheck` and `bun run test`.

The repository's lockfile pins the kit, so a repository moves only when it runs these steps.
[CHANGELOG.md](../../CHANGELOG.md), shipped in the package, lists what each release changed.

## Related topics

- [The shipped files](../shipped-files.md)
- [CHANGELOG.md](../../CHANGELOG.md)
