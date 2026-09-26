# Contribute to checks

Whoever changes the kit follows these steps in a clone of this repository, before opening a pull request and when cutting a release.

## Before you begin

- Bun at the version `.bun-version` pins, since CI builds `dist/` with it and another version emits different bytes.

## Check a change

To check a change the way CI does:

1. Run `bun install`.
1. Run `bun run build`, which rewrites the files it generates, as Regenerate what is committed lists.
1. Run `bun run lint`, which runs oxlint, the kit's own gates through `scripts/lint.ts`, and the dependency cruise.
1. Run `bun run typecheck`.
1. Run `bun run test`, which runs the suite through `scripts/test.ts`.

Declare each skip with `skipReason(reason, name)` beside the native Bun test call, as [checks-test](docs/gates/checks-test.md) says.

CI runs the commands `gates.ci` lists in `quality.json`, which include `git diff --exit-code` over the whole tree after the build and the commit lint on the pull request title.

## Regenerate what is committed

Each generated file is committed, and lint, the suite or CI's diff after the build fails on one left stale.

To regenerate after an edit:

1. After editing `sources.effect` in `quality.json` or a file in `presets/`, run `bun scripts/quality.ts generate`, which rewrites `oxlintrc.quality.json` and `tsconfig.quality.json`.
1. After editing `effect-channel/`, `scripts/feature-rules.ts`, the schema in `scripts/quality-file.ts` or the templates in `scripts/doc-templates.ts`, run `bun run build`.
   It rewrites `dist/index.js`, `dist/feature-rules.js`, `quality.schema.json` and `templates/`.
1. After editing anything a generated block names as its source in its opening marker, run `bun run build`, which rewrites every generated block.
1. Commit what the command rewrote in the same commit as the edit.

## Release a version

A release is a tag on `main`, which the `release` workflow publishes through npm trusted publishing, so no token is stored anywhere and GitHub mints the publish credential for each run.

To release a version:

1. In a pull request that holds only the release, bump `version` in `package.json` and run `bun run build`.
   The build writes the version's section into `CHANGELOG.md` from the conventional commits since the last release, so the changelog is never edited by hand.
1. Commit both as `chore: release <version>` and title the pull request the same.
   The squash merge lands the title as the commit's subject, and a `feat` or `fix` title would add an entry the committed changelog lacks.
1. Rebase the pull request onto `main` right before it merges, since a commit merged in between belongs to the release and the committed section would lack it.
1. Once it merges, tag that commit on `main` with the version and push the tag, since the version bump commit closes the release:

   ```sh
   tag="v$(bun -p 'require("./package.json").version')"
   git tag "$tag" && git push origin "$tag"
   ```

1. Watch the `release` workflow.
   It refuses a tag off `main` or one that disagrees with `package.json`.
   It reruns the build, the check that the build changed no committed file, lint, typecheck and the suite before it publishes to npm.
   After npm publish succeeds, the workflow creates or updates the GitHub release with the matching `CHANGELOG.md` section.

`publishConfig.access` in `package.json` is what makes the scoped package public.
npm attaches a trusted publisher only to a package that already exists, so a package's first version goes out by hand.
That is `npm publish` from the tagged commit as `avi2dg`, then adding the trusted publisher in the package's npm settings, with the repository `avi2d/checks` and the workflow `release.yml`.
That first tag's `release` run fails on the already-published version, and every later tag publishes through the workflow.

## Find where a change goes

To place a change:

1. Find the path it belongs under:

   | Path | What it holds |
   | --- | --- |
   | `scripts/` | every bin, and the modules they share |
   | `effect-channel/` | the oxlint plugin with the Effect error-channel and cognitive complexity rules |
   | `dist/` | the committed bundles of the plugin and of `featureRules` |
   | `presets/` | the Effect presets `checks-quality` builds its fragments from |
   | `templates/` | one template per kind of doc file, which `bun run build` renders |
   | `CHANGELOG.md` | every release, which `bun run build` writes from the conventional commits |
   | `tests/` | the suite, with the tests that spawn a process under `tests/e2e/` |
   | `docs/gates/` | one reference page per bin |
   | `docs/configs/` | one reference page per shipped config a bin does not own |
   | `docs/design.md` | why the kit is shaped the way it is |
   | the root configs | `oxlintrc.json`, `tsconfig.effect.json`, `bunfig.toml`, `commitlint.config.js`, `dependency-cruiser.config.js`, `stryker.preset.js` and `quality.schema.json`, which a consuming repository extends or copies |

1. Change the page under `docs/` that describes the behaviour in the same commit as the behaviour.
   A new bin gets its page under `docs/gates/`, and the suite fails until it has one.

This repository holds itself to the kit, with two exceptions of its own.
Its `.dependency-cruiser.cjs` redeclares `no-orphans` with the plugin entry added to its `pathNot`.
Its `.oxlintrc.json` lifts `effect-channel/no-throw` from `scripts/comment-matchers.ts`, whose synchronous `refused()` a host loads without `node_modules`.

## Related topics

- [checks](README.md)
- [Why it is shaped this way](docs/design.md)
