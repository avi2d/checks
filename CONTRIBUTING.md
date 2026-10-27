# Contribute to checks

Whoever changes the kit follows these steps in a clone of this repository, before opening a pull request and when cutting a release.

## Before you begin

- Bun at the version `.bun-version` pins, since CI builds `dist/` with it and another version emits different bytes.

## Check a change

To check a change before opening a pull request:

1. Run `bun install`.
1. Run `bun run build`, which rewrites the files it generates, as Regenerate what is committed lists.
1. Run `bun run lint`, which runs oxlint and then the kit's own gates through `src/core/lint.ts`, the dependency cruise among them.
1. Run `bun run typecheck`.
1. Run `bun run desk`, which runs the unit tier, the e2e files the change touches, the range gates and the fast tree gates.
1. Before opening a pull request, run `bun run lint -- --full` for the unscoped gate set.

Declare each skip with `skipReason(reason, name)` beside the native Bun test call, as [checks-test](docs/gates/checks-test.md) says.
A test that spawns `checks-lint` passes it `withoutPullRequestEvent()` from `tests/lib/env.ts`, so the CI event cannot decide the range.

CI runs the commands in `.github/workflows/ci.yml` and lints the pull request title in its `static` job.
`.github/workflows/mutation.yml` runs Stryker, with `stryker.conf.mjs`, as a baseline on `main` or on any branch by hand, and no pull request runs it.
The workflow has no schedule: the weekly full baseline starts with `gh workflow run mutation`.
A hand-started run restores the previous full baseline state, so it retests the mutants its changes reach and fits the job timeout, while a result made stale by a file a test reads at runtime lasts until the next 28-day refresh.
That run uploads the report and the incremental state again as the `mutation-baseline-full` artifact.
A push run restores the previous baseline through [checks-mutation-baseline](docs/gates/checks-mutation-baseline.md).
`.github/workflows/night-run.yml` runs at 02:07 UTC, and `gh workflow run night-run` starts it by hand, queued behind any night run already going.
It runs a full Stryker run and the unit and e2e levels of the suite, and keeps each JUnit report.
[checks-night-run](docs/gates/checks-night-run.md) then opens or comments on one issue labelled `night-run` for each file whose mutation score fell since the previous night and for each failing test.
A failed mutation run still leaves each failing test filed, and records no score.
A run started on a branch other than `main` lists its findings in the log and files no issue.
Each issue is fixed in a pull request of its own, so no pull request waits for a mutation run.
Run `bun run mutate -- --mutate <file>` to mutate one source file locally, since the preset refuses a full run outside CI.
The patch under `patches/` makes `@hughescr/stryker-bun-runner` honour Stryker's hit limit, so a mutant whose code loops endlessly ends as a `Timeout` within seconds.
A static mutant, evaluated once when its module loads, never reaches that limit and still waits for `timeoutMS`.
The patch applies only to this repository's install, not to a repository that installs the kit.

## Regenerate what is committed

Each generated file is committed, and lint, the suite or CI's diff after the build fails on one left stale.

To regenerate after an edit:

1. After editing `src/quality/effect-channel/`, `src/complexity/readability/`, `src/quality/data-shape/`, `src/quality/presets/` or the templates in `src/docs/doc-templates.ts`, run `bun run build`.
   It rewrites `dist/`, and writes `oxlintrc.json` and `dependency-cruiser.config.js` from the config builders.
1. After editing the Effect paths in `oxlint.config.ts`, run `bun run build`, whose `checks-effect-scope` rewrites the Effect override in `tsconfig.json`.
1. After editing anything a generated block names as its source in its opening marker, run `bun run build`, which rewrites every generated block.
1. Commit what the command rewrote in the same commit as the edit.

## Release a version

A release is a tag on `main`.
The `release` workflow publishes it through npm trusted publishing.
GitHub mints the publish credential for each run, so no npm token is stored anywhere.

Every push to `main` runs the `release-push` workflow, which releases the next version when `main` holds a feature or a fix since the last tag, as [checks-release-push](docs/gates/checks-release-push.md) says.

To release a version:

1. Merge the feature or fix through the repository's usual merge path.
   Nothing else is needed, and the changelog is never edited by hand.
1. Watch the `release-push` run of that push, or run `gh workflow run release-push` to start one.
   It commits the version bump and the section the build writes into `CHANGELOG.md` as `chore: release <version>` on top of `main`, and runs `ci` on that commit from the `release/main` branch.
   Once `ci` passes, it moves `main` to the release commit, tags it and dispatches the `release` workflow on the tag.
   A failed `ci` leaves `main` and the tags alone, and the run names the failed run.
   A `main` that moved while `ci` ran keeps its new head, and the run of that push releases it.
1. Watch the `release` workflow.
   The release workflow refuses a ref that is not a tag, a tag off `main` or one that disagrees with `package.json`.
   It reruns the build, the check that the build changed no committed file, lint, typecheck and the suite before it publishes to npm through [checks-release-publish](docs/gates/checks-release-publish.md).
   That step leaves the version off npm when npm already holds a newer one.
   Once it passes, the workflow creates or updates the GitHub release with the matching `CHANGELOG.md` section.

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
   | `dist/` | the committed oxlint plugin bundles, the config builders compiled under `dist/presets/`, and the Stryker preset's helpers compiled under `dist/mutation/` |
   | `dist/templates/` | one template per kind of doc file, which `bun run build` renders |
   | `src/quality/presets/` | the oxlint, Knip, dependency-cruiser and stylelint config builders, and the Effect language service severities |
   | `CHANGELOG.md` | every release, which `bun run build` writes from the conventional commits |
   | `tests/` | the suite, with the in-process tests under `tests/unit/` and the tests that spawn a process under `tests/e2e/` |
   | `docs/gates/` | one reference page per bin |
   | `docs/configs/` | one reference page per shipped config a bin does not own |
   | `docs/design.md` | why the kit is shaped the way it is |
   | the root configs | `tsconfig.effect.json` with the `ts-reset.d.ts` it lists, `bunfig.toml`, `commitlint.config.ts` and `stryker.preset.js`, which a consuming repository extends or copies, and `oxlintrc.json` and `dependency-cruiser.config.js`, which the build writes for a repository that extends them by path |

1. Change the page under `docs/` that describes the behaviour in the same commit as the behaviour.
   A new bin gets its page under `docs/gates/`, and the suite fails until it has one.

This repository holds itself to the kit through its own `oxlint.config.ts`, `knip.config.ts` and `dependency-cruiser.config.ts`, with these exceptions:

- Its `oxlint.config.ts` lifts `effect-channel/no-throw` from `src/quality/comment-matchers.ts`, whose synchronous `refused()` a host loads without `node_modules`.
- It keeps the oxlint plugins and the oxlint, Knip, dependency-cruiser and stylelint builders outside its Effect paths, since a tool loads each synchronously.
- It keeps the `checks-flake` preload outside its Effect paths, since Bun loads it into every test file.
- Its `dependency-cruiser.config.ts` names each plugin entry in `orphans`, and adds `host-loaded-imports-nothing`.

## Related topics

- [checks](README.md)
- [Why it is shaped this way](docs/design.md)
