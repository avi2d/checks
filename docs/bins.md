---
kind: reference
audience: consumers
---
# The bins

The kit ships one bin per check, each named `checks-` and called from a package script.

## What runs

`checks-lint` runs each of these gates that applies to the repository, and names every one that fails.
A gate reads either the working tree or the range `checks-lint` resolves, or the whole tree at the head under `checks-lint --night`.
It scopes tree gates to the change unless `--full` forces the full run, and `--desk` runs the fast tree gates.
The table groups the gates by vector, the part of a repository each one judges.

<!-- generated gates: bun run build writes it from KIT_GATES in src/core/gates.ts and scripts/doc-blocks.ts -->

| Vector | Gate | Reads | Runs in |
| --- | --- | --- | --- |
| complexity | [`checks-suppressions-ratchet`](gates/checks-suppressions-ratchet.md) | the range | every repository |
| complexity | [`checks-repetition`](gates/checks-repetition.md) | the range | a repository tracking `*.ts` or `*.tsx` |
| complexity | [`checks-unused`](gates/checks-unused.md) | the working tree | a repository tracking `*.ts` or `*.tsx` or `*.astro` |
| complexity | [`checks-exports`](gates/checks-exports.md) | the range | a repository tracking `*.ts` or `*.tsx` |
| quality | [`checks-lint-coverage`](gates/checks-lint-coverage.md) | the working tree | a repository tracking `*.ts` or `*.tsx` or `*.astro` |
| quality | [`checks-comment-gate`](gates/checks-comment-gate.md) | the range | every repository |
| quality | [`checks-effect-scope`](gates/checks-effect-scope.md) | the working tree | a repository tracking `oxlint.config.ts` |
| quality | [`checks-frontend-syntax`](gates/checks-frontend-syntax.md) | the working tree | a repository tracking `frontend-syntax.json` |
| quality | [`checks-css-size`](gates/checks-css-size.md) | the working tree | a repository tracking `*.css` |
| quality | [`checks-no-plain-js`](gates/checks-no-plain-js.md) | the working tree | a repository tracking `*.ts` or `*.tsx` |
| testing | [`checks-test-layout`](gates/checks-test-layout.md) | the working tree | a repository tracking `*.ts` or `*.tsx` |
| testing | [`checks-quarantine-clock`](gates/checks-quarantine-clock.md) | the range | every repository |
| docs | [`checks-docs`](gates/checks-docs.md) | the range, and every agent file at the head commit | every repository |
| docs | [`checks-copy`](gates/checks-copy.md) | the working tree | a repository tracking `copy.json` |
| delivery | [`checks-commit-identity`](gates/checks-commit-identity.md) | the range | every repository |
| delivery | [`checks-ci-wiring`](gates/checks-ci-wiring.md) | the working tree | every repository |
| delivery | [`checks-secrets`](gates/checks-secrets.md) | the range | every repository |
| dependencies | [`checks-imports`](gates/checks-imports.md) | the working tree | a repository tracking `*.ts` or `*.tsx` |
| dependencies | [`checks-advisories`](gates/checks-advisories.md) | the range | a repository tracking `bun.lock` |

<!-- end generated gates -->

Four of these gates run only at night.
They are `checks-lint-coverage`, `checks-quarantine-clock`, `checks-repetition` and `checks-suppressions-ratchet`.
The night-run workflow runs them with `checks-lint --night`, which hands each range gate `--whole-tree HEAD`, so the four judge the whole tree with no base.

These bins run on their own:

- [`checks-test`](gates/checks-test.md) runs the suite as `scripts.test` and refuses a skip without a reason at its test site.
- [`checks-flake`](gates/checks-flake.md) runs the suite on a schedule and records the seeds a flaky test fails with.
- [`checks-mutation`](gates/checks-mutation.md) runs Stryker for scoped checks and refuses a full run outside CI.
- [`checks-mutation-compare`](gates/checks-mutation-compare.md) compares the mutants of two reports and lists each one that regresses.
- [`checks-mutation-baseline`](gates/checks-mutation-baseline.md) restores the newest mutation baseline from `main`, saves it on a self-hosted runner's disk in place of an artifact, and deletes superseded baselines after a `main` run.
- [`checks-mutation-scope`](gates/checks-mutation-scope.md) turns a branch's diff into the files its mutation runs mutate.
- [`checks-subsumed-tests`](gates/checks-subsumed-tests.md) lists each test another test subsumes in a mutation run.
- [`checks-night-run`](gates/checks-night-run.md) opens or comments on one GitHub issue per finding of a night run on `main`, each file whose mutation score fell, each failing test, and each failed nightly gate.
- [`checks-changelog`](gates/checks-changelog.md) writes the pending release into `CHANGELOG.md` from the conventional commits since the last release.
- [`checks-release-notes`](gates/checks-release-notes.md) writes one `CHANGELOG.md` section to a file for a GitHub release.
- [`checks-release-report`](gates/checks-release-report.md) tells whether the history holds unreleased features or fixes since the last tag.
- [`checks-release-pr`](gates/checks-release-pr.md) opens or refreshes the pull request that releases the next version, and dispatches its checks.
- [`checks-release-preflight`](gates/checks-release-preflight.md) refuses the release before it starts when the version disagrees with the last tag or the run lacks the trusted publisher prerequisites.
- [`checks-release-publish`](gates/checks-release-publish.md) publishes the version `package.json` holds to npm, unless npm already holds it or a newer version.
- [`checks-release-push`](gates/checks-release-push.md) releases a package's next version onto its branch once the checks pass, tags it and dispatches the release workflow on the tag.
- [`checks-release-tag`](gates/checks-release-tag.md) tags a landed release commit with its version and dispatches the release workflow on the tag.
- [`checks-vendor`](gates/checks-vendor.md) pins each library its `prepare` arguments name to a shared read-only clone and links it under `repos/`.
- [`checks-browser`](gates/checks-browser.md) opens a product's built pages in Chrome and fails on the layout, keyboard, motion, accessibility, nesting and asset checks its `browser-checks.json` declares.
- [`checks-commit-title`](gates/checks-commit-title.md) lints the pull request title in one step of the `ci` job.
- [`checks-pr-text`](gates/checks-pr-text.md) scans the title, body and comments of a pull request in a public repository for a secret or a term of the private pack.
- [`checks-docs-only`](gates/checks-docs-only.md) tells whether a change touches only top-level Markdown and Markdown under `docs/`, so a docs-only change skips the full run.
- [`checks-setup`](gates/checks-setup.md) writes the kit config, the CI workflow and the doc templates into a new repository.

`checks-lint` has [its own page](gates/checks-lint.md), which says which range it resolves.
oxlint runs through its own tool, as [Native settings](configs/native-settings.md) says.

## Related topics

- [Set up a repository](how-to/set-up-a-repository.md)
- [Native settings](configs/native-settings.md)
