# Contribute to checks

Whoever changes the kit follows these steps in a clone of this repository, before opening a pull request and when cutting a release.

## Before you begin

- Bun at the version `.bun-version` pins, since CI builds `dist/` with it and another version emits different bytes.

## Check a change

To check a change before opening a pull request:

1. Run `bun install`.
1. Run `bun run build`, which rewrites the files it generates, as Regenerate what is committed lists.
1. Run `bun run lint`, which runs oxlint and then the scoped kit gates through `src/core/lint.ts`.
1. Run `bun run typecheck`.
1. Run `bun run desk`, which runs the test files the change reaches and the fast tree gates.
1. Before opening a pull request, run `bun run lint -- --full` for the unscoped gate set.

Declare each skip with `skipReason(reason, name)` beside the native Bun test call, as [checks-test](docs/gates/checks-test.md) says.
A test that spawns `checks-lint` passes it `withoutPullRequestEvent()` from `tests/lib/env.ts`, so the CI event cannot decide the range.

CI runs the commands in `.github/workflows/ci.yml` on each pull request, and on the release branch when `release-pr` dispatches it.
A pull request runs only the tests it reaches, and the release pull request runs the whole suite, as [checks-test](docs/gates/checks-test.md#pull-request-runs) says.
`.github/workflows/pr-title.yml` lints the pull request title, so editing the title reruns only that.
No workflow runs on a schedule except the weekly advisory scan, as [checks-ci-wiring](docs/gates/checks-ci-wiring.md#schedules) requires.
No workflow runs mutation testing except `.github/workflows/mutation.yml`, which calls the shared mutation workflow and starts on no push, unlike the caller [checks-setup](docs/gates/checks-setup.md) writes.
That caller runs `baseline` only when started by hand with `gh workflow run mutation`.
A merge to `main` starts no mutation run.
It runs `compare` on each pull request.
It runs `refresh` by hand every 28 days.
No workflow runs the long test tiers, the whole-tree sweep or the issue filing on its own.
`bun run lint` runs the three range whole-tree lint gates over each pull request's range.
It runs `checks-lint-coverage` only when the change selects the tree gates, since that gate reads the working tree.
The sweep runs the four whole-tree gates by hand through `bun src/core/lint.ts --whole-tree` over the whole tree with no base.
It reports every suppression count and every repeated line still present until it is removed.
Issue filing runs only under a workflow the owner writes when one is wanted, from the commands [checks-whole-tree-run](docs/gates/checks-whole-tree-run.md#running-it-by-hand) shows.
[checks-whole-tree-run](docs/gates/checks-whole-tree-run.md) opens or comments on one issue labelled `whole-tree-run` for each file whose mutation score fell since the previous run, for each failing test, and for each whole-tree gate that failed.
It also files each mutation report a failed or timed-out mutation job never wrote.
It closes the issue of a test, a gate or a missing mutation report that a later run no longer reports, and it comments on a mutation issue it no longer reports without closing it, but only when a previous run exists and every requested mutation report is present.
A failed mutation run still leaves each failing test filed, and records no score.
A run started on a branch other than `main` lists its findings in the log and files no issue.
Each issue is fixed in a pull request of its own, so no pull request waits for a whole-tree run.
Run `bunx stryker run --mutate <file>` to mutate one source file locally, since the preset refuses a full run outside CI.
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

The kit releases on demand through a release pull request.
Firstmate decides when to release, only for a reason, such as another repository needing a merged change, a fix users need, or merged changes having waited a week.

To release a version:

1. Run `gh workflow run release-pr` to open the release pull request.
   It commits the version bump and the section the build writes into `CHANGELOG.md` as `chore: release <version>` on the `release/main` branch, and runs `ci` on that commit.
   Nothing else is needed, and the changelog is never edited by hand.
1. Merge the release pull request through the repository's usual merge path once `ci` passes.
   Merging it tags the release commit through the `tag` job and dispatches the `release` workflow on the tag.
1. Watch the `release` workflow.
   The release workflow refuses a ref that is not a tag, a tag off `main` or one that disagrees with `package.json`.
   The tag run repeats no test tiers, since the whole suite already ran on the release pull request.
   The release pull request holds current `main` when it merges.
   A `tested-tree` step fetches the pull request head the squash number names and refuses a landed tree that differs from the tree the pull request tested.
   The `release` workflow runs the same check on the tag, so either step rejects a mismatched or unverifiable tree.
   checks-release-publish leaves the version off npm when npm already holds a newer one.
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
   | `tests/` | the suite, with the in-process tests under `tests/unit/` and the tests that spawn a process under `tests/e2e/` and `tests/live/` |
   | `tests/unit/<area>/`, `tests/e2e/<area>/` | the tests of `src/<area>/`, with the tests of `scripts/` under `scripts/` and the tests of the packed package as a whole and the repository-wide layout checks under `package/` |
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
- Its `dependency-cruiser.config.ts` adds one rule per area under `src/`, which lets the area import `src/core/` and only the other areas `AREA_IMPORTS` lists for it.

## Related topics

- [checks](README.md)
- [Why it is shaped this way](docs/design.md)
