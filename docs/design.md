---
kind: explanation
---
# Why it is shaped this way

Most of the kit's shape follows from a limit in a tool it runs on, such as oxlint, bun, npm, Stryker or GitHub Actions.
Each section names the limit and what the obvious alternative would break.

## Each tool reads its own config

A repository keeps each setting in the file its tool reads, such as `.oxlintrc.json`, `tsconfig.json` or `.jscpd.json`.
A developer then changes a rule where the tool reads it, and the tool's own docs describe that file.
The Effect paths sit in two of those files, `.oxlintrc.json` and `tsconfig.json`, and the installed consumer test checks each one on its own.

oxlint does not pass `plugins` down an `extends` chain.
A config in the chain that sets no `plugins` gets oxlint's default plugins, and the base's `categories` then turn on their rules across the tree.
So a consumer's `.oxlintrc.json` and each of its overrides list `plugins` again.
`rules`, `categories` and `jsPlugins` pass down the chain as expected.
`.gitignore` keeps oxlint out of `node_modules/`, because oxlint still walks the installed package when only `ignorePatterns` names it.

The base turns `data-shape/readonly-collection-param` on for every TypeScript file and `data-shape/schema-twin` on for production files only.
`typescript/prefer-readonly-parameter-types` would flag every object parameter for deep `readonly`, so the kit rule stays with the collections a function never mutates.
A test that declares its own schema as an oracle for a production type is reasonable, so the twin rule leaves `tests/` out.

bun has no bunfig `extends`, and it ignores an unknown top-level key without a warning.
So a repository copies the kit's `bunfig.toml`, and `checks-test-layout` compares the copy with the installed one key by key.
An empty `--path-ignore-patterns` flag overrides the copied `[test] pathIgnorePatterns`, which is how a quarantined test still runs on demand.

Stryker 10 does not resolve `extends` in a JSON config.
So the Stryker preset is a JavaScript module that a repository's `stryker.conf.mjs` spreads, and a key set after the spread wins.

The dependency-cruiser base parses with swc, because TypeScript 7, which is tsgo, has no compiler API that dependency-cruiser can use.
Without `@swc/core` installed, the cruise skips every `.ts` file without a warning, so the kit's own suite asserts that its TypeScript is cruised.
The base counts `bun` as a built-in module.
Only `@types/bun` resolves it, and that package is a dev dependency, so every runtime `bun` import would otherwise read as dev only.

## The shared configs close gaps in the types

The shared configs refuse four places where a value's type says less than the value does.
Each sits in a file a consumer already extends or copies.

The base `oxlintrc.json` turns on the five `typescript/no-unsafe-*` rules in an override for `.ts` and `.tsx` files outside `tests/`, so every consumer gets them through `extends`.
`typescript/no-explicit-any` and `strict` already refuse an `any` someone writes, so the `any` left is one nobody wrote.
`Array.isArray` narrows an `unknown` to `any[]`, `JSON.parse` returns `any`, `Object.entries` lists `any` values from an `object`, and a defaulted parameter in a generator passed to `Effect.fnUntraced` is typed `any`.
Tests stay out because bun:test types its asymmetric matchers, such as `expect.arrayContaining`, as returning `any`.
Those matchers made 22 of the 34 findings in the tests of the kit and its consumers.

`tsconfig.effect.json` sets `exactOptionalPropertyTypes`, so every repository that extends it gets the option in the same release.
`Schema.optionalKey` means the key is missing, never `undefined`.
Without the option, a type derived from the schema accepts an `undefined` the schema rejects when it decodes.
tsc keeps no baseline, and the only escape for one site is a `@ts-expect-error`, which `typescript/ban-ts-comment` refuses.
So each error the option raises is fixed where it lands.

The language service preset sets `processEnv` and `processEnvInEffect` at error, so code in a repository's Effect paths reads the environment through `Config`.
`Config` decodes a variable and fails in the error channel when it is missing, where `process.env` hands back a `string | undefined` that each caller checks by hand.
The language service keeps no baseline either, so each read the two diagnostics find moves to `Config` when a repository takes the preset.

`tsconfig.effect.json` loads the `is-array` and `json-parse` rules of `@total-typescript/ts-reset`, so tsc refuses code that relied on the `any` that `Array.isArray` and `JSON.parse` hand out.
The `no-unsafe-*` rules flag each place that `any` is used, and these two rules close it where it starts, in `tests/` as well.
The other eight ts-reset rules stay out, because `set-has` breaks correct code in the kit and a consumer, and the rest find nothing.
A global declaration reaches a program only when a root file, a `types` entry or an import names it, and a repository's own `files`, `include` or `types` replaces the fragment's list of the same name.
So the fragment lists the rules in `files`, and in `include` beside every file under the repository's `tsconfig.json`, and one of the two lists survives unless a repository sets both.
`types` cannot carry the rules, since every consumer sets its own `types` to reach `bun`.
`checks-lint-coverage` fails the repository that sets both lists, because nothing in tsc would say the rules were gone.

## The source is sorted by what it judges

The source sits under `src/<vector>/`, one directory for each thing the kit judges a repository on: complexity, quality, testing, docs, delivery and dependencies.
`src/core/` holds what every vector runs on.
`scripts/` holds only the kit's own build, and nothing in it ships.
Sorting files by what loads them would put both oxlint plugins at the root and every bin in one flat directory.
Nothing would then say which gate a helper serves.
A mutation runner's default scope covers `src/`, so the kit's own Stryker run mutates its source with no `mutate` list.
The testing directory is named `testing` rather than `tests`, because a `src/tests/` beside the root `tests/` would read as a second suite.

Four `exports` keys name a path the file does not sit at, because consumers resolve them by that name.
`@avi2dg/checks/scripts/test-skips.ts`, `@avi2dg/checks/scripts/comment-matchers.ts` and `@avi2dg/checks/scripts/prose-matchers.ts` point at their files under `src/`.
`@avi2dg/checks/templates/*` points at `dist/templates/`.
A path read without the resolver, such as `node_modules/@avi2dg/checks/scripts/test-skips.ts`, does not exist.

## The package ships built plugins and runnable bins

`files` in `package.json` lists what an install gets.
`tests/`, `AGENTS.md` and the TypeScript source of the oxlint plugins never reach an install.
npm adds `package.json`, `README.md` and `LICENSE` whatever `files` says.
`bun pm pack` builds the same tarball the registry serves, and the consumer e2e test installs that tarball.

Each oxlint plugin ships compiled under `dist/`, because Node refuses to strip types from a `.ts` file under `node_modules`.
`@oxlint/plugins` ships no RuleTester, so each `effect-channel`, `readability` and `data-shape` rule is proven red and green against an installed consumer in `tests/e2e/consumer.test.ts`.
`dist/` is committed, with the doc templates in `dist/templates/`, and so is `CHANGELOG.md`, which the same build writes.
No `prepack` or `prepublishOnly` script rebuilds them, so a publish ships the committed files.
CI runs `git diff --exit-code` over the whole tree after `bun run build`.
A test that compares a generated file with its source cannot do this job, because it would read the copy the build just rewrote.

Each runnable script ships as a `checks-` bin, so a consumer's `package.json` script calls it by the short name.
The package manager puts a bin on `PATH` only inside a package script.
A shell reaches it through `bun run`, which never falls back to the registry the way `bunx` does.
The `.ts` bins keep a `bun` shebang and need no build step, unlike the oxlint plugins that Node loads.

The bins are written in Effect.
So `effect` is a peer dependency, and `@effect/platform-bun`, which only the bins use, is a dependency.
`@effect/platform-node-shared` is a direct dependency only to pin its version.
`@effect/platform-bun` asks for it with a `^` range, and a newer release candidate of it peers on a newer `effect` than consumers install.
So the three packages move together at one exact version.

## checks-lint runs each gate as its own bin

`checks-lint` runs each gate in a child process rather than importing it.
A gate then behaves the same alone or through `checks-lint`, and `lint-coverage.sh` can stay a shell script.
The gates run one at a time and pass their output straight through, so each report reads whole and in the order of the gate table.
`checks-lint` picks the gates that apply from the tracked files, and a repository cannot select gates.
A TypeScript gate runs as soon as the repository tracks TypeScript source.

GitHub authors the pull request merge commit it builds as `GitHub <noreply@github.com>`, and `checks-commit-identity` refuses that author.
So `checks-lint` ends a pull request's range at the event's head commit, and the merge commit is never in it.
A `lint` that calls `checks-commit-identity HEAD` directly checks out `github.event.pull_request.head.sha` rather than the default merge ref.

## Workflows say how CI runs

A repository's workflow YAML says how CI runs, and the kit says which commands must run.
`checks-ci-wiring` holds a repository to title lint on every pull request and to the `bun run` commands its own `package.json` defines, so a repository with no `build` script is not asked to run one.
The target branch comes from git's `refs/remotes/origin/HEAD`, or in CI from the pull request base or the default branch in GitHub's event.
It never comes from the workflow files, and `checks-lint` starts its local range from the same branch.
`checks-ci-wiring` runs inside `lint`, not in a workflow of its own.
The violation it catches is a deleted workflow step, so it has to fail in the local `lint`.
It parses workflows with `Bun.YAML`, which the `bun` shebang already provides, so it adds no dependency.
It reads `on` as a string key, not as the YAML 1.1 boolean.

## Size and repetition only fail on growth

The size limits are oxlint's own rules at `error`, not a script of the kit's.
A script of the kit's own would restate how oxlint reads its config and compares sites, and each restatement adds cases oxlint itself does not have.
A repository records its existing violations with `oxlint --suppress-all`, and `checks-suppressions-ratchet` refuses any count that rises.
The cost is that a file or function already over its limit can grow without adding a site the count sees.
Each repository works its counts down to zero.

`checks-repetition` runs jscpd at both ends of the range with the head's `.jscpd.json`, so the same `path` and `ignore` globs pick the files at both ends.
It compares each file's count of repeated lines, and does not use jscpd's `--baseline-from-ref`.
That flag reports a repeated block as new once its text changes, so a change that shortens an existing repeated block would fail.

## checks-test runs the suite itself

`checks-test` runs bun itself rather than reading a report that another run left.
A skip taken only on CI shows only in CI's own run, and an earlier run's report may be stale or narrowed.
It reads the JUnit report bun writes to a temporary directory, because bun has no other per-test output meant for a program.

## Quarantine has one limit

`checks-quarantine-clock` holds every quarantined test to one limit of 30 days.
GitLab quarantines a flaky test for 3 days on its fast path, and for at most 3 months on its long path.
It then opens a merge request that deletes the test.
The kit's one limit falls between GitLab's two, so a flaky test gets a month to be fixed, and no path keeps it out of the run for 3 months.

## The changelog comes from the commits

`CHANGELOG.md` is generated from the commits, so the release commit carries it and the tarball ships it.
The commit that bumps `version` in `package.json` closes a release, and the `v*` tag goes on that commit.
Commits merged after the bump wait for the next release.
Releases come from the version bumps across all of `HEAD`'s ancestry, not from tags.
So a checkout without tags, a fork, and a branch that merged `main` in all write the same file when no release was reverted.
A section keeps the date it was written, because the squash merge that lands the release commit may fall on another day.
Entries come from commit subjects, which are the squash-merged pull request titles that commitlint holds to the conventional format.
A commit body holds the branch's own messages, and nothing lints it, so no entry comes from a body.
The changelog arrives in the release pull request, and no workflow pushes to the repository.
The only write access the release path holds is the `github-release` job's `contents: write`, which creates or updates the GitHub release from the tag's `CHANGELOG.md` section.

## The docs gate judges what a change touches

The templates in `dist/templates/` are rendered from `src/docs/doc-templates.ts`, which is the spec `checks-docs` reads.
A template written by hand beside the check would agree with it only until someone edits one of them.
A page's Diátaxis mode comes from `kind` front matter on the page, whatever directory holds it.
The repository judges the mode beside the page, and the check holds the page to that mode's template.

`checks-docs` holds a doc file to its template only when a change touches it, the way `checks-comment-gate` judges only the comments a change adds.
A repository adopts the templates as its files change, and an untouched file is listed as advisory.
The prose rules judge only the lines a change adds or edits.
A report about the past is refused the way a promise about the future is, because history on a living page reads as current fact.
Text nobody touched never breaks the templates or the prose rules, and a record keeps the words it was written in.
A repository needs no cleanup pass before the gate runs, except on its agent files.
The ceiling, the rule against a `## Maintaining this file` section and the entry rule judge every agent file at the head commit, because an agent reads the whole file every session, touched or not.
Review, not the check, keeps a task heading verb first.
No word list tells `Test layout` from `Test the layout`, and a check that passes the noun would be worse than none.

A living doc takes one sentence per line, so a changed line is a changed sentence.
Under a hard wrap, a one-word edit reflows a paragraph, and the gate would demand fixes to sentences the edit never touched.
An agent file such as `AGENTS.md` takes the separator rules and the rule against a report about the past, and no other prose rule.
An agent reads stale history as literally as a person, so the past rule judges agent files too.
One sentence per line serves the people who review a doc's diffs.
An agent file keeps each entry on one line, however many sentences it holds.
The reference check reads agent files too, because a path they name goes stale the same way.
Readability grades and words such as easy stay out of the prose rules.
A score cannot fail a change without failing correct prose, and a suggestion that only an editor shows is never seen.

`src/docs/prose-matchers.ts` imports nothing, so the gate and a write-time hook run one matcher and refuse in the same words.
A hook bundle ships without `node_modules`, so a matcher that needed Vale or another package could not refuse at write time.

A path, link or command on a line the range leaves alone still fails when the range broke it, for example by deleting the file it names.
A reference goes stale far more often because the code it names moves than because its own line is edited.
So a gate on edited lines alone would miss the usual break.
A name that is not a path goes stale the same way, and the reference check never reads it.
So the range that removes such a name from every file outside the docs fails on each line that still carries it.
A path under a top directory the repository lacks names a file in another repository, such as a consumer's.
No program can tell such a path from a typo.
A directory the range deletes still counts as this repository's, so a path under it reads as stale rather than foreign.
The command check passes over a page whose front matter sets `audience: consumers`, because such a page names a consuming repository's scripts.

## checks-vendor keeps a tree whose write bit came back

The GitHub Actions runner clears the read only mode of each item before it deletes `$RUNNER_TEMP`.
On a directory link, that change lands on the shared tree's top directory.
Refusing the tree would fail every later job on the runner until a person cleared it.
Cloning the tree again would need the network after every such job.
A write bit is not a write.
So `checks-vendor` strips an owner write bit and checks the tree against its recorded commit like any other tree.
A write it finds there still fails the run.
A group or other write bit fails the run, because another user could have edited `.git/config` through it before `git status` reads it.

## Advisories fail only the range that adds them

`checks-advisories` compares the advisories at both ends of a range instead of failing on every advisory at the head.
An advisory published against a package that landed a month earlier would otherwise fail every open pull request, including one that touches only docs.
The scheduled `--all` run finds those advisories, and `advisory-acks.json` carries the ones a repository accepts for a while.

The gate runs OSV-Scanner rather than Trivy, Grype or `bun audit`.
Trivy 0.74.0 reads a nested `bun.lock` entry such as `mkdirp/minimist` under a name no advisory carries, so it misses every package bun nests.
Grype 0.119.0 drops the dev dependencies of `bun.lock` with no setting that keeps them.
`bun audit` asks the npm registry on every run and has no offline mode.
OSV.dev's npm export also holds OpenSSF's reports of malicious packages, which GitHub's reviewed advisories leave out.

The kit pins the scanner by version and by the SHA-256 of each build, because a scanner release is code that runs on every runner.
Trivy's own advisory GHSA-69fq-xp46-6x23 records a malicious release published with stolen credentials.
The scan runs offline against a database refreshed once a day, so most runs need no network.

The acknowledgement file belongs to the kit rather than to `osv-scanner.toml`.
OSV-Scanner's `ignoreUntil` accepts any day, such as 2099-01-01, and measures it against the clock of the machine that runs the scan.
The kit caps each entry at 30 days and measures a range from the head's dates, as `checks-quarantine-clock` does, so a commit gets the same verdict on every run.
`--all` measures from the current time instead, because a head's dates never move in a repository that takes no commit, and an entry measured from them would never expire.
The file is JSON because `Bun.TOML` cannot parse a TOML date.

## Related topics

- [checks](../README.md)
- [The dependency rules](configs/dependency-rules.md)
