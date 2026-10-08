# Contribute to checks

Whoever changes the kit follows these steps in a clone of this repository, before opening a pull request and when cutting a release.

## Before you begin

- Bun at the version `.bun-version` pins, since CI builds `dist/` with it and another version emits different bytes.

## Check a change

To check a change the way CI does:

1. Run `bun install`.
1. Run `bun run build`, which rewrites the files it generates, as Regenerate what is committed lists.
1. Run `bun run lint`, which runs oxlint, the kit's own gates through `src/core/lint.ts`, and the dependency cruise.
1. Run `bun run typecheck`.
1. Run `bun run test`, which runs the suite through `src/testing/test.ts`.

Declare each skip with `skipReason(reason, name)` beside the native Bun test call, as [checks-test](docs/gates/checks-test.md) says.
A test that spawns `checks-lint` passes it `withoutPullRequestEvent()` from `tests/lib/env.ts`, so the CI event cannot decide the range.

CI runs the commands in `.github/workflows/ci.yml` and lints the pull request title in `.github/workflows/commitlint.yml`.
`.github/workflows/mutation.yml` runs Stryker, with `stryker.conf.mjs`, as a baseline on `main` or on any branch by hand, and as an advisory comparison scoped to the sources a pull request changes or reaches through a changed test, helper or fixture.
The workflow has no schedule: the weekly full baseline starts with `gh workflow run mutation`.
A hand-started run restores no state and passes `--disableBail`, so its report lists every covering and killing test.
That run uploads the report again as the `mutation-baseline-full` artifact.
The scope step reads that artifact from the newest successful hand-started run on `main`.
The comparison passes `--ignoreStatic` to both of its Stryker runs, so it never scores a static mutant, and the full baseline still does.
The head run resumes from the merge-base run's incremental state, even when the pull request changes a test.
Stryker reruns each mutant whose covering test file changed, and it compares only the test file's own source.
So the state the head run resumes from drops each unit test that reads a changed helper or fixture.
Run `bun run mutate -- --mutate <file>` to mutate one source file locally, since the preset refuses a full run outside CI.
The patch under `patches/` makes `@hughescr/stryker-bun-runner` honour Stryker's hit limit, so a mutant whose code loops endlessly ends as a `Timeout` within seconds.
A static mutant, evaluated once when its module loads, never reaches that limit and still waits for `timeoutMS`.
The patch applies only to this repository's install, not to a repository that installs the kit.

## Regenerate what is committed

Each generated file is committed, and lint, the suite or CI's diff after the build fails on one left stale.

To regenerate after an edit:

1. After editing `src/quality/effect-channel/`, `src/complexity/readability/`, `src/quality/data-shape/` or the templates in `src/docs/doc-templates.ts`, run `bun run build`.
   It rewrites `dist/`.
1. After editing anything a generated block names as its source in its opening marker, run `bun run build`, which rewrites every generated block.
1. Commit what the command rewrote in the same commit as the edit.

## Release a version

A release is a tag on `main`.
The `release` workflow publishes it through npm trusted publishing.
GitHub mints the publish credential for each run, so no npm token is stored anywhere.

The `daily-release` workflow opens a `chore: release <version>` pull request once a day when `main` holds a feature or a fix since the last tag, as [checks-release-pr](docs/gates/checks-release-pr.md) says.
It needs the repository's **Allow GitHub Actions to create and approve pull requests** setting.

To release a version:

1. Find the open `chore: release <version>` pull request, or run `gh workflow run daily-release` to open it now.
   It holds only the version bump and the section the build wrote into `CHANGELOG.md`, so the changelog is never edited by hand.
1. If `main` moved under it, run `gh workflow run daily-release` again rather than updating the branch.
   The job rebuilds the release on the new `main`, while a merge of `main` into the branch leaves the committed changelog short of the commits the merge brought, which fails the build check.
1. Merge the pull request through the repository's usual merge path once its checks pass and it holds current `main`, and keep its title.
   The squash merge lands the title as the commit's subject, and a `feat` or `fix` title would add an entry the committed changelog lacks.
1. Watch the `release` workflow, which the `tag` job of `daily-release` dispatches once it tags the merge commit.
   The `tag` job first reruns the build, and refuses to tag a merge whose `CHANGELOG.md` the build rewrites.
   Its error says to open a `chore: cancel the unpublished <version>` pull request that returns `package.json` to the last tag's version and commits what `bun run build` then writes to `CHANGELOG.md`.
   The build reads the returned version as a revert, so it drops the unpublished section, and the next `daily-release` run cuts the release again with every change since the last tag.
   The release workflow refuses a ref that is not a tag, a tag off `main` or one that disagrees with `package.json`.
   It reruns the build, the check that the build changed no committed file, lint, typecheck and the suite before it publishes to npm.
   After npm publish succeeds, the workflow creates or updates the GitHub release with the matching `CHANGELOG.md` section.

`publishConfig.access` in `package.json` is what makes the scoped package public.
The package's npm settings name the repository `avi2d/checks` and the workflow `release.yml` as its trusted publisher.

## Find where a change goes

To place a change:

1. Find the path it belongs under:

   | Path | What it holds |
   | --- | --- |
   | `src/core/` | the `checks-lint` entry point, the gate registry and the modules every bin runs on |
   | `src/complexity/` | the gates that bound how large and tangled code may grow, and the `readability` oxlint plugin |
   | `src/quality/` | the gates that hold code correct and idiomatic, the `effect-channel` and `data-shape` oxlint plugins, and the opt-in frontend checks, with the browser runner under `src/quality/browser/` |
   | `src/testing/` | the gates that judge how the suite is laid out, run and trusted |
   | `src/docs/` | the doc gate and the rules it reads |
   | `src/delivery/` | the gates and bins for how a change reaches `main` and a release, and what a commit may not carry |
   | `src/dependencies/` | what code may import, which library sources an agent reads, which locked package versions carry a known advisory, and the pinned download of each scanner a gate runs |
   | `scripts/` | the kit's own build and CI tooling, which nothing ships |
   | `dist/` | the committed oxlint plugin bundles |
   | `dist/templates/` | one template per kind of doc file, which `bun run build` renders |
   | `src/quality/presets/` | the Effect rule blocks consumers copy into native configs |
   | `CHANGELOG.md` | every release, which `bun run build` writes from the conventional commits |
   | `tests/` | the suite, with the in-process tests under `tests/unit/` and the tests that spawn a process under `tests/e2e/` |
   | `docs/gates/` | one reference page per bin |
   | `docs/configs/` | one reference page per shipped config a bin does not own |
   | `docs/design.md` | why the kit is shaped the way it is |
   | the root configs | `oxlintrc.json`, `tsconfig.effect.json` with the `ts-reset.d.ts` it lists, `bunfig.toml`, `commitlint.config.js`, `dependency-cruiser.config.js`, `stryker.preset.js`, which a consuming repository extends or copies |

1. Change the page under `docs/` that describes the behaviour in the same commit as the behaviour.
   A new bin gets its page under `docs/gates/`, and the suite fails until it has one.

This repository holds itself to the kit, with two exceptions of its own.
Its `.dependency-cruiser.cjs` redeclares `no-orphans` with each plugin entry added to its `pathNot`.
Its `.oxlintrc.json` lifts `effect-channel/no-throw` from `src/quality/comment-matchers.ts`, whose synchronous `refused()` a host loads without `node_modules`.

## Related topics

- [checks](README.md)
- [Why it is shaped this way](docs/design.md)
