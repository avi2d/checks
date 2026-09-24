# checks

Deterministic checks shared across my TypeScript repos. One package,
`@avi2dg/checks`: the `checks-lint` entry point that runs every lint gate
below over a range it resolves itself, the `checks-test` entry point
that runs the suite and refuses an undeclared skip, the `checks-flake`
run that records the seeds a failing test fails with, the oxlint base
config, the tsconfig fragment with the Effect language-service block,
the `quality.json` schema with the generator that turns its Effect paths
into oxlint and tsconfig fragments, the shared commitlint config, the
shared dependency-cruiser base with the feature-owner rules `quality.json`
compiles into it, the test-layout check with its bunfig preset, the commit-identity check, the
comment gate with its backtest, the oxlint suppressions ratchet, the
size budget, the feature-owner change signal and proof check, the
Stryker mutation-testing preset with its no-regression comparator, the
CI-wiring check, a template for each kind of doc file with the gate that
holds each doc file to its template, and the Effect error-channel plugin
compiled to JavaScript.

Published as `@avi2dg/checks` on the public npm registry.

## Before you begin

- Bun, which runs every bin.
  The kit is tested on the version its own `.bun-version` pins.
- A git repository, whose history the range gates read.
- The peer versions the install line below pins, which `peerDependencies` in `package.json` holds.

## Install

From the consuming repo:

```sh
bun add -d @avi2dg/checks effect@4.0.0-rc.115 oxlint@1.83.0 oxlint-tsgolint@7.0.2002 @effect/tsgo@0.45.0 typescript@7.0.2 dependency-cruiser@18.4.0 @swc/core@1.16.2
```

`.oxlintrc.json`:

```json
{
  "extends": ["./node_modules/@avi2dg/checks/oxlintrc.json"],
  "plugins": ["typescript", "oxc", "eslint", "import"]
}
```

`.gitignore` keeps oxlint out of `node_modules/`:

```
node_modules/
```

`tsconfig.json` gains one line:

```json
{
  "extends": "@avi2dg/checks/tsconfig.effect.json"
}
```

`quality.json` at the repository root declares what the repository
opts into, starting with the commands its CI runs. See "Declare policy in the quality file"
below:

```json
{
  "$schema": "./node_modules/@avi2dg/checks/quality.schema.json",
  "gates": { "ci": ["bun run lint", "bun run typecheck", "bun run test"] }
}
```

`bunfig.toml` is a copy of the shipped preset:

```sh
cp node_modules/@avi2dg/checks/bunfig.toml bunfig.toml
```

`package.json` gains three scripts:

```json
"lint": "oxlint --type-aware && checks-lint",
"typecheck": "tsc --noEmit && effect-tsgo diagnostics --project tsconfig.json --format text --strict",
"test": "checks-test"
```

`checks-test` runs `bun test --randomize` and fails on a skip the
repository has not declared. See "Run the suite" below.

`checks-lint` runs every kit gate a lint needs. See "Run every lint gate"
below. Three of them:

`lint-coverage.sh` fails when oxlint silently skips a tracked `.ts` or
`.tsx` file, for example through a stray `.gitignore` entry. It compares
`git ls-files` against oxlint's own file walk and names the missing files.
It exits 2 when oxlint cannot walk the tree, as when it is not on `PATH`
or its config does not parse.

`test-layout.ts` decides the test layout described below.

`commit-identity.ts` refuses a commit with an author other than the
repository owner. See "Check commit identities" below.

A repo that runs mutation testing installs `@stryker-mutator/core` and
`@hughescr/stryker-bun-runner`, then spreads the shipped preset in
`stryker.conf.mjs`:

```js
import preset from "@avi2dg/checks/stryker.preset.js";

export default {
  ...preset,
};
```

The registry version is pinned by the consumer's lockfile; bump
`@avi2dg/checks` to adopt a new release.

## Declare policy in the quality file

`quality.json` at the repository root says what the repository has
opted into. The kit's bins find it at the git root and read it there:

```json
{
  "$schema": "./node_modules/@avi2dg/checks/quality.schema.json",
  "defaultBranch": "main",
  "gates": {
    "ci": ["bun run lint", "bun run typecheck", "bun run test"],
    "scheduled": ["bunx checks-flake --runs 10 --report flake-report.json"]
  },
  "commitIdentity": { "authors": [{ "name": "avi2d", "email": "avi2dg@gmail.com" }] },
  "sources": {
    "production": ["src/**/*.ts"],
    "effect": { "paths": ["src/**/*.ts"], "exempt": ["src/host/*.ts"] }
  },
  "size": { "fileLines": 400, "functionLines": 100, "applies": "changed" },
  "features": [
    {
      "name": "billing",
      "root": "src/billing",
      "entries": ["src/billing/index.ts"],
      "allowFrom": ["src/main.ts"],
      "proof": "tests/e2e/billing.test.ts"
    }
  ],
  "changeSignal": "advisory",
  "agentRules": { "on": [], "off": [] },
  "docs": { "pages": { "reference": ["docs/gates/*.md"], "explanation": ["docs/design.md"] } }
}
```

| Key | Read by | Holds |
| --- | --- | --- |
| `defaultBranch` | `checks-lint`, `checks-ci-wiring` | the branch pull requests merge into, `main` when absent |
| `gates.ci` | `checks-ci-wiring` | the commands CI runs on every pull request. See "Check the CI wiring" |
| `gates.scheduled` | `checks-ci-wiring` | the commands a schedule runs |
| `gates.lint` | `checks-lint`, `checks-ci-wiring` | the gates `checks-lint` runs when not all apply. See "Gate selection" |
| `commitIdentity.authors` | `checks-commit-identity` | the identities allowed to author and commit. See "Check commit identities" |
| `sources.effect` | `checks-quality` | the paths held to the Effect rules, and the files under them that are not. See "Enforce the Effect rules" |
| `sources.production` | `checks-size-budget`, `checks-quality` | the source the repository ships. See "Hold files to a size budget" |
| `size` | `checks-size-budget` | the line budget, and which production files it holds. See "Hold files to a size budget" |
| `features` | `featureRules`, `checks-feature-owners` | each feature's root, entries, exempt importers and proof. See "Declare feature owners" |
| `changeSignal` | `checks-feature-owners` | `advisory` to list the feature owners a change touches. See "Declare feature owners" |
| `agentRules.on`, `agentRules.off` | agent Rule selection, not the kit | catalogued Rules switched on or off for this repository |
| `docs.pages` | `checks-docs` | the Diátaxis mode of each page, by glob. See "Hold docs to their templates" |

Every key is optional. The bins decode the file with one Effect
`Schema`, and the package ships `quality.schema.json` emitted from that
schema, so the `$schema` line gives an editor the verdict the bins
reach, save what no JSON Schema can express across two values, which
the bins refuse: a Rule switched both on and off, a feature entry
outside its root, and two features with one name or sharing a root. A key the schema does
not name is refused, not ignored, so a misspelt `sources` cannot switch
the Effect rules off unnoticed. A glob in `sources`
starts at the repository root, names a directory first, uses `*`
only within a segment and `**` only as a whole one, and ends in a file
name with an extension, which are the globs oxlint, the language
service and git all read alike. oxlint matches `*.ts` at any depth
where the other two match it at the root alone, so the schema refuses
it; `**/*.ts` means every depth to all three. The language service
matches nothing for `src/**` and oxlint nothing for `src/lib`, so the
schema refuses both; `src/**/*.ts` and `src/lib/*.ts` say it to all
three.

Until a later minor release, a repository with no `quality.json` still
has `ciWiring` and `commitIdentity` read from `package.json`, with a
notice on each read. One with both exits 2 until `package.json` drops
them. The keys map one for one:

| `package.json` | `quality.json` |
| --- | --- |
| `ciWiring.gates` | `gates.ci` |
| `ciWiring.scheduled` | `gates.scheduled` |
| `ciWiring.lintGates` | `gates.lint` |
| `ciWiring.defaultBranch` | `defaultBranch` |
| `commitIdentity` | `commitIdentity` |

### Generated fragments

oxlint and tsc read their own JSON and nothing else, so
`checks-quality generate` writes what `sources.effect` declares into two
fragments at the repository root, and the hand-written configs extend
them. Both fragments are committed:

```sh
checks-quality generate
checks-quality --check
```

`.oxlintrc.json`:

```json
{
  "extends": ["./node_modules/@avi2dg/checks/oxlintrc.json", "./oxlintrc.quality.json"],
  "plugins": ["typescript", "oxc", "eslint", "import"]
}
```

`tsconfig.json`:

```json
{
  "extends": ["@avi2dg/checks/tsconfig.effect.json", "./tsconfig.quality.json"]
}
```

`oxlintrc.quality.json` holds one override: the declared paths as
`files`, the exempt ones as `excludeFiles`, and the kit's Effect rule
block, `presets/effect.oxlint.json`. `tsconfig.quality.json` holds the
language-service override: the same paths as `include`, the exempt ones
as `exclude`, and `presets/effect.language-service.json`. A kit release
that changes a preset reaches the repository through its next
`generate`. A rule only this repository needs stays in its own
`.oxlintrc.json`, whose overrides come after the fragment's and so win.

`checks-lint` runs `checks-quality --check`, which exits 1 when:

- a fragment is missing, or differs from what `generate` would write
  from `quality.json` and the installed kit's presets;
- a fragment is left over once `quality.json` stops declaring
  `sources.effect`;
- `.oxlintrc.json` or `tsconfig.json` does not list its fragment in
  `extends`, so the tool never reads it;
- a `sources.effect.paths` glob, or a `sources.production` glob while
  `size` is declared, matches no tracked or untracked file, so it holds
  nothing.

It exits 2 when `quality.json` does not decode. `generate` writes the
fragments, removes a left-over one, then runs the same check.

```
checks-quality: 2 problem(s) with what quality.json declares:
  oxlintrc.quality.json is stale against quality.json and the kit's presets; run checks-quality generate
  tsconfig.json does not extend ./tsconfig.quality.json, so the language service never reads it
```

Two details of the fragments are easy to get wrong, so the kit's tests
pin both:

- A fragment sits at the repository root. oxlint resolves an
  override's `files`, and the language service an override's `include`,
  against the directory of the config holding it. From `.quality/` the
  language service reports no error at all on an `async function`
  planted under a declared path.
- The oxlint fragment always sets `plugins`, to the kit's. A config in
  `extends` that sets none brings in oxlint's default plugins, whose
  category rules then fire across the whole tree. The override names
  the kit's plugins beside the preset's `node`, `promise` and `unicorn`,
  because one that leaves any of the kit's out turns on the category
  rules of the plugins it adds under every declared path.

## Run every lint gate

`checks-lint` runs each of the kit's lint gates in turn and names every
one that fails, rather than stopping at the first. A repository whose
tracked files give a gate nothing to check can leave it out through
`gates.lint`. See "Gate selection" under "Check the CI wiring".

| Gate | Reads |
| --- | --- |
| `checks-lint-coverage` | the working tree |
| `checks-test-layout` | the working tree |
| `checks-commit-identity` | the range |
| `checks-comment-gate` | the range |
| `checks-suppressions-ratchet` | the range |
| `checks-ci-wiring` | the working tree |
| `checks-docs` | the range |
| `checks-quality` | the working tree |
| `checks-size-budget` | the range |
| `checks-feature-owners` | the range |

```sh
checks-lint
checks-lint <base-ref> <head-ref>
```

It resolves the range once and hands the same one to every range gate.
Locally, and on any event other than a pull request, the range ends at
`HEAD` and starts where `HEAD` branched from the origin default branch:
`origin/HEAD`, or when `origin/HEAD` is not set, as in an
`actions/checkout` clone, `origin/<defaultBranch>` from the
repository's `quality.json`, as "Declare policy in the quality file" says, and `origin/main` when
that is not declared. In a GitHub Actions pull request, where
`GITHUB_EVENT_NAME` is `pull_request`, it ends
at the event's head sha and starts where that branched from
`origin/<base branch>`, so GitHub's merge commit is never in it. The
base branch is read from the fetch, not from the event's recorded base
sha, which GitHub leaves stale once the base branch advances after the
pull request opens. Explicit base and head arguments override both.

The range always starts at the merge base, never at the base branch's
tip: commits the base branch gained after the head branched off would
otherwise count against the head. When the head is the merge base, as
on a push to the default branch or a local run on it, the range would be
empty, so each range gate is handed that tip commit alone and checks it
against its parent, or against the empty tree when it is a repository's
first commit:

```
checks-lint: tip 10ba7d8935b73ed72624120a1542e51bd21ca7c7 from HEAD against origin/main
```

A clone with no remote-tracking refs at all, such as a freshly
initialised repository with no remote or one whose remote was never
fetched, has no default branch to start from, so each range gate is
handed `HEAD` alone the same way:

```
checks-lint: tip 10ba7d8935b73ed72624120a1542e51bd21ca7c7 from HEAD alone, as the clone has no remote-tracking refs
```

Once any ref sits under `refs/remotes/`, a missing
`origin/<default branch>` exits 2 instead, since that is the shape of a
shallow CI checkout, where `HEAD` alone would leave the commits before
it unchecked.

It prints the range, the declared selection if there is one, each
gate's own report, then its verdict:

```
checks-lint: range 2504acf098d120e73a8ece3c96f22b934f35c6a8..10ba7d8935b73ed72624120a1542e51bd21ca7c7 from HEAD against origin/main
...
checks-lint: 3 of 9 gate(s) failed: checks-commit-identity, checks-comment-gate, checks-suppressions-ratchet
```

It exits 1 when any gate found a violation, and 2 when the range or the
selection does not resolve, or no failing gate could decide. ci-wiring
always runs, so a repository on `checks-lint` declares `gates.ci`,
as "Check the CI wiring" says, and it holds the test layout unless its selection
leaves out `checks-test-layout`.

CI runs it through `lint`. The checkout fetches the whole history, which
the merge base needs:

```yaml
on:
  pull_request:
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun run lint
```

## Enforce the Effect rules

The base config loads the `effect-channel` plugin and turns on
`effect-channel/no-error-channel-escape`, which refuses `Effect.ignore`,
`Effect.ignoreCause`, the `Effect.catchCause` family, and an
`Effect.catch` whose handler takes no error or names it `_`.

Two more rules ship off, because a repository writes only some of its
paths in Effect: code a host loads without `node_modules`, such as a
hook bundle or this oxlint plugin, cannot import it.

- `effect-channel/no-throw` refuses a `throw` statement.
- `effect-channel/no-try-catch` refuses a `try` statement with a
  `catch` clause. `try`/`finally` stays allowed.

Each refusal says what to write instead: a `Schema.TaggedError` failed
through `Effect.fail`, a throwing call wrapped in `Effect.try` or
`Effect.tryPromise`, and recovery by tag with `Effect.catchTag`.

A repository turns them on for the paths it writes in Effect by
declaring those paths in `quality.json` and extending the generated
fragments. See "Generated fragments" under "Declare policy in the quality file":

```json
"sources": {
  "effect": { "paths": ["src/**/*.ts"], "exempt": ["src/host/*.ts"] }
}
```

The fragment's override carries the kit's Effect rule block,
`presets/effect.oxlint.json`: the two rules above, plus `node/no-sync`,
`oxc/no-async-await`, `promise/avoid-new` and `unicorn/no-process-exit`.
Files under `exempt` answer to none of them.

oxlint resolves `files` against the directory of the config that holds
the override, so a config passed with `-c` from outside the repository
matches nothing and reports nothing.

`unicorn/no-process-exit` passes over any file that opens with a
shebang, so a repository whose bins open with one bans `process.exit`
itself with `no-restricted-properties` in its own `.oxlintrc.json`, as
this one does. The preset leaves that rule out because
a repository's own `no-restricted-properties` list for the same files
would replace it, or be replaced by it. Sites standing when the
declaration lands go in oxlint's own baseline, `oxlint --suppress-all`,
so their count can only fall. This repository's own `.oxlintrc.json`
also lifts `effect-channel/no-throw` from `scripts/comment-matchers.ts`,
the one file under its Effect path that a host loads without
`node_modules`.

The language service holds the same paths to Effect-native IO through
the tsconfig fragment's override, whose severities are
`presets/effect.language-service.json`: `nodeBuiltinImport`,
`asyncFunction`, `newPromise` and `extendsNativeError`, all errors.
effect-tsgo keeps the severities `tsconfig.effect.json` sets when a later
config in `extends` restates the plugin with only its overrides.

## Lay out the tests

`checks-test-layout` fails unless the repo holds this shape, and names the
file and the path to move it to when it does not:

- Every test file is `tests/**/*.test.ts` or `.tsx`. A `*.test.ts`, `*.spec.ts` or
  `*_test.ts` under `src/`, `test/`, `__tests__/` or the repo root fails.
  Tracked and untracked files that `git ls-files --exclude-standard`
  reports are scanned, so `node_modules/` and every gitignored tree are
  out of reach, and a local run agrees with CI before `git add`.
- `tests/lib/**` holds helpers and `tests/fixtures/**` holds data; neither
  may hold a test file. Every other directory directly under `tests/` is a
  test group and may nest as deep as it likes.
- Two levels. A test outside `tests/e2e/` runs in-process, so it may not
  import `node:child_process`, `net`, `http`, `https`, `http2`, `tls` or
  `dgram`, may not import `$`, `spawn`, `spawnSync`, `connect`, `serve` or
  `listen` from `bun`, may not touch `Bun.$` or `Bun.spawn`, and may not
  call `fetch`. A test inside `tests/e2e/` may do all of it. Helpers in
  `tests/lib/**` answer to the same rule, since an in-process test reaches
  them; `tests/fixtures/**` is data and is not parsed. Detection parses
  with swc and reads import specifiers and identifier use, so a test that
  only carries `"node:child_process"` as a string is not a violation.
- `scripts.test` is exactly `checks-test`, which runs `bun test --randomize`
  as "Run the suite" says, and `scripts.lint` runs this check, itself or
  through `checks-lint` called by its bare bin name.
- `bunfig.toml` carries every `[test]` key of the shipped preset with the
  same value, and `[test].pathIgnorePatterns` is always
  `["**/tests/quarantine/**"]`: the check pins it itself, so this repo,
  whose bunfig is the preset, cannot drift it either. Other tables, and
  extra `[test]` keys, are the repo's own.

The in-process half is what a mutation run can mutate; `tests/e2e/**` is
excluded from a mutate scope by construction, because a subprocess kills
both the speed and the coverage signal a mutant needs.

The preset also skips `tests/quarantine/**` on a default run. A test that
turns flaky moves there, so the suite stays trustworthy, and the flake is
still run on demand:

```sh
bun test --path-ignore-patterns='' tests/quarantine
```

## Run the suite

`checks-test` runs the whole suite with `bun test --randomize`, passes
bun's output through, and then reads bun's JUnit report of the same run.
bun exits 0 with tests skipped, so a green run says nothing about the
tests that never ran. `checks-test` fails when a test was skipped, by
`test.skip`, `test.skipIf`, `test.if`, `describe.skip` or `test.todo`,
without a declaration in `package.json`:

```json
"testSkips": [
  {
    "file": "tests/e2e/docker.test.ts",
    "test": "images > builds the release image",
    "reason": "the runner has no docker daemon",
    "when": "ci"
  }
]
```

`file` is the path bun reports, relative to the package root, and `test`
is the name bun's console prints: the describe blocks and the test name
joined by ` > `. `reason` is required. `when` is `ci` or `local` for a
test skipped only there, and a declaration without it holds in both;
`checks-test` counts a run as `ci` when `CI` is set true, as GitHub
Actions sets it. A declaration that holds for the run but matches no
skipped test fails a ci run too, so a fixed or renamed test takes its
declaration with it. A local run only warns about it, because whether a
test skips there can hang on the machine, such as a docker daemon being
up:

```
checks-test: 1 skipped test(s) undeclared and 1 declaration(s) matching no skipped test in this ci run:
  tests/pricing.test.ts:12 pricing > rounds half to even: skipped with no declaration; run it, or declare it in package.json testSkips with its reason
  tests/e2e/docker.test.ts > images > builds the release image: declared, but no such test skipped; delete the declaration
```

It exits 1 when a test failed or a skip is undeclared or, in a ci run,
a declaration stale, and 2 when `testSkips` does not parse or bun
passed without writing its report. It takes no arguments: a `-t`
filter reports every test it leaves out as skipped and a path filter
drops files a declaration names, so a narrowed run is plain
`bun test --randomize` with the arguments. Files under
`tests/quarantine/` are never run and so never reported. See "Test
layout".

## Find flaky tests

A green run proves nothing failed in that run, not that no test is
flaky. `checks-flake` runs the whole suite several times, each with its
own `--seed`, and records per failing test the seeds it failed with:

```sh
checks-flake [--runs <count> | --seed <seed>...] [--report <file>]
```

`--runs` defaults to 10 runs on random seeds, and `--seed`, given once
per run, replays chosen seeds, such as the ones a report recorded.
`bun test --randomize --seed=<seed>` puts the suite in the same order,
so a seed reproduces a failure that hangs on order. `--report` writes the
record as JSON, every run's seed and failing tests and every failing
test's seeds, and under GitHub Actions the summary below is appended to
the job summary:

```
checks-flake: 3 of 10 run(s) failed, 1 test(s) failing in them

| Test | Failed | Seeds |
| --- | --- | --- |
| tests/cache.test.ts:6 reads the cache | 3 of 10 runs | 2170533150, 4046124386, 180394251 |

Reproduce a failing run with bun test --randomize --seed=<seed>.
```

A run that fails with no failing test, such as a test file that throws
while loading, is listed with its seed on its own line. It exits 1 when
any run failed and 2 when bun passed without writing its report.

A consumer runs it on a schedule and keeps the record as an artifact:

```yaml
on:
  schedule:
    - cron: "17 5 * * *"
  workflow_dispatch:
jobs:
  flake:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bunx checks-flake --runs 10 --report flake-report.json
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: flake-report
          path: flake-report.json
```

and declares the step in `gates.scheduled`, so `checks-ci-wiring`
fails once the schedule stops running it. See "Check the CI wiring".

## Enforce dependency rules

`.dependency-cruiser.cjs` extends the shared base, which carries
`no-circular`, `no-orphans`, `not-to-dev-dep` (shipped source importing
a dev-only package, which a package listed in `peerDependencies` too is
not), `not-to-unresolvable` (nothing installed answers the
specifier), and `no-deep-imports` (a subpath the package's exports map
does not publish):

```js
module.exports = {
  extends: "./node_modules/@avi2dg/checks/dependency-cruiser.config.js",
  forbidden: [
    {
      name: "ui-cannot-reach-server",
      severity: "error",
      from: { path: "^src/ui" },
      to: { path: "^src/server" },
    },
  ],
};
```

That last block is the layer-boundary recipe: append a named rule per
boundary you own. A rule that restates a base name overrides it field
by field, which is how an entry point stops being an orphan:
redeclare `no-orphans` with your entry added to its `pathNot`.
This repo's own `.dependency-cruiser.cjs` does that for the plugin
entry. A repository that declares feature owners spreads the rules
`quality.json` compiles to into the same `forbidden`. See "Feature
owners".

`package.json` gains the script:

```json
"lint:deps": "depcruise --config .dependency-cruiser.cjs src"
```

Enforcement runs in CI beside the other checks:

```yaml
jobs:
  lint:
    steps:
      - uses: actions/checkout@v5
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun run lint:deps
```

## Lint commit messages

Commits follow `@commitlint/config-conventional` plus the house
prefixes listed in `commitlint.config.js`, shared from
`@avi2dg/checks/commitlint.config.js`. It arrives with the registry
dependency above, since `@commitlint/cli` and
`@commitlint/config-conventional` are dependencies, not peers.
Enforcement runs in CI on pull requests, because `jj` never fires a
git hook. Add this workflow to the consuming repo:

```yaml
on:
  pull_request:
    types: [opened, edited, synchronize, reopened]
jobs:
  commitlint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: printf '%s' "$PR_TITLE (#0000)" > "$RUNNER_TEMP/pr-title"
        env:
          PR_TITLE: ${{ github.event.pull_request.title }}
      - run: ./node_modules/.bin/commitlint --config ./node_modules/@avi2dg/checks/commitlint.config.js --edit "$RUNNER_TEMP/pr-title"
```

It lints the pull request title and nothing else. The title is the
enforced subject because squash merges use the PR title as the main
commit subject; per-commit messages are not linted. GitHub appends
` (#N)` to the squashed subject, so the workflow lints the title with
that suffix attached and the header length limit applies to the landed
subject, not the bare title.

It never sees a commit's author or committer fields, nor the
`Co-authored-by` trailer GitHub writes from a foreign author when it
squashes, so it cannot enforce who a commit belongs to. The
commit-identity check below is the enforcement.

## Check commit identities

`scripts/commit-identity.ts` walks every commit in a range and fails when
one carries an identity other than the repository owner's:

```sh
bun run checks-commit-identity <base-ref> <head-ref>
bun run checks-commit-identity <ref>
```

With one argument it checks that commit alone. It refuses a commit
whose author or committer is outside the allowlist, and one whose
trailer block carries a `Co-authored-by:` trailer as git parses it, and
it names the offending commit and reason. Other trailers and prose mentioning an address in the
body are left alone. `GitHub <noreply@github.com>` is allowed as
committer only, since that is who writes a squash merge.

The allowlist defaults to `avi2d <avi2dg@gmail.com>`. A repo with other
owners restates it in `quality.json`:

```json
"commitIdentity": {
  "authors": [{ "name": "avi2d", "email": "avi2dg@gmail.com" }]
}
```

`checks-lint` runs it over each pull request's range.
See "Run every lint gate".

## Refuse banned comments

`scripts/comment-gate.ts` runs the comment check over a diff and fails
when an added line carries a banned comment:

```sh
bun run checks-comment-gate <base-ref> <head-ref>
bun run checks-comment-gate <ref>
```

With two arguments it diffs the base against the head. With one it diffs
that commit against its parent, or against the empty tree for a
repository's first commit, which has none. It exits 2 when the parent
exists but is not in the clone rather than widening to the whole tree,
so a shallow checkout running the one-argument form needs
`fetch-depth: 2`. Only added lines
are checked, so a violation in a file the diff never touches stays
silent, and a refusal counts when any line of the comment carrying it was
added. The check refuses a machine-read directive, a record or ticket
pointer, a doc block, and a file opening with a rationale block over
three lines, licence headers excepted.

`scripts/comment-matchers.ts` holds the scanner, the comment syntaxes
and a synchronous `refused()`, and imports nothing, so a host such as a
hook bundle can copy it alone into a directory with no `node_modules`
and import it as `@avi2dg/checks/scripts/comment-matchers.ts`. The repo's
cruise fails when it gains an import. `scripts/comments.ts` wraps the
same matchers in Effect for the gate and the backtest.

`checks-lint` runs it over each pull request's range.
See "Run every lint gate".

## Ratchet the suppressions

`scripts/suppressions-ratchet.ts` holds oxlint's bulk-suppression
baseline, `oxlint-suppressions.json`, to counts that only fall. oxlint
accepts whatever `oxlint --suppress-all` writes, so raising a count to
let a new site through passes the lint. The ratchet reads the file at a
base and a head and fails naming each file and rule whose count rose or
that appeared:

```sh
bun run checks-suppressions-ratchet <base-ref> <head-ref>
bun run checks-suppressions-ratchet <ref>
```

With one argument it compares that commit with its parent, or with the
empty tree for a repository's first commit, and exits 2 when the parent
exists but is not in the clone. With two it reads the base where
the head branched off, at their merge-base, so a count the base branch
lowered since does not read as a rise at the head. A count that fell and
an entry that went both pass. A commit without the file counts as empty,
so the commit that first adds a baseline fails with every entry
appearing. The file is read from the directory the command runs in,
which is where oxlint writes it. It exits 2 when a ref does not resolve
or the file is not oxlint's count per rule per file:

```
suppressions-ratchet: 2 count(s) in oxlint-suppressions.json rose or appeared; fix the site instead of suppressing it:
  src/added.ts typescript/no-unsafe-type-assertion appeared with 1
  src/dispatch.ts typescript/no-non-null-assertion rose from 12 to 13
```

`checks-lint` runs it over each pull request's range.
See "Run every lint gate".

## Hold files to a size budget

`checks-size-budget` holds production files to the line budget
`quality.json` declares, and lists every other file over it without
failing:

```json
"sources": { "production": ["src/**/*.ts"] },
"size": { "fileLines": 400, "functionLines": 100, "applies": "changed" }
```

```sh
checks-size-budget <base-ref> <head-ref>
checks-size-budget <ref>
```

It runs oxlint with a configuration of two rules and nothing else:
`max-lines` at `fileLines` and `max-lines-per-function` at
`functionLines`, both counting blank and comment lines. With `applies`
set to `changed` it holds the files under `sources.production` that the
range adds or changes, a rename that edits the file included. With
`all` it holds every file under `sources.production`. A file the range
deletes or only renames is not held. Every other tracked `.ts` or
`.tsx` file over the budget, tests and unchanged production files alike,
is listed as advisory and never fails the gate; `.d.ts` files are not
measured.

It reads each file from the head commit rather than the working tree,
so an uncommitted edit neither fails nor passes a range, and a pull
request's merge checkout measures what the pull request holds. With two
arguments the range starts where the head branched from the base, at
their merge-base. With one it is that commit against its parent, or
against the empty tree for a repository's first commit. oxlint must be
on `PATH`, as it is under a package script.

```
size-budget: 1 overrun(s) of 400 lines per file and 100 per function in the production files the range adds or changes:
  src/billing/ledger.ts:12: The function `settle` has too many lines (131). Maximum allowed is 100.
size-budget: advisory, 1 overrun(s) where the budget does not hold yet:
  tests/e2e/billing.test.ts: File has too many lines (512).
```

It exits 1 on an overrun in a file it holds, and 2 when `quality.json`
does not decode, a ref does not resolve or oxlint cannot run. A
repository that declares no `size` passes. `quality.json` refuses a
`size` without `sources.production`, which would hold nothing, and
with `size` declared `checks-quality` refuses a `sources.production`
glob that matches no file. Moving `applies` from `changed` to `all`
tightens the budget to every production file, once the advisory list
names none.

`checks-lint` runs it over each pull request's range.
See "Run every lint gate".

## Declare feature owners

A repository opts a feature in by declaring, in `quality.json`, the
directory it owns, the files code outside it imports it through, the
files that may reach past those, and the end-to-end test that proves it
runs:

```json
"features": [
  {
    "name": "billing",
    "root": "src/billing",
    "entries": ["src/billing/index.ts"],
    "allowFrom": ["src/main.ts", "src/cli/*.ts"],
    "proof": "tests/e2e/billing.test.ts"
  }
],
"changeSignal": "advisory"
```

`root` is a directory and `entries` are files under it, both without
globs. `allowFrom` holds globs of the same shape as `sources`. `proof`
is a `.test.ts` or `.test.tsx` file under `tests/e2e/`. Nothing moves:
a root is wherever the feature already lives. `quality.json` refuses an
entry outside its root, a name used twice, and two features sharing a
root or one root inside another, so a file has at most one owner.

### Import boundary

`dist/feature-rules.js` compiles `features` into one dependency-cruiser
rule per feature, which `.dependency-cruiser.cjs` spreads beside its
own:

```js
const { featureRules } = require("@avi2dg/checks/dist/feature-rules.js");

module.exports = {
  extends: "./node_modules/@avi2dg/checks/dependency-cruiser.config.js",
  forbidden: [...featureRules(require("./quality.json"))],
};
```

A module outside a feature's root that imports a file inside it must
import one of the feature's `entries`. Modules under `tests/` and the
files `allowFrom` matches, such as a CLI or a harness, may import any
file in it:

```
error feature-billing-entries: src/report.ts → src/billing/charge.ts
```

`featureRules` decodes its argument with the schema the bins use and
throws the schema's refusal when it does not decode, which stops the
cruise. It is an ES module, as `effect` is, so a `.cjs` config loads it
through `require`, which needs node 20.19, 22.12 or later.

### Change signal and proof

`checks-feature-owners` reads the same declaration over a range:

```sh
checks-feature-owners <base-ref> <head-ref>
checks-feature-owners <ref>
```

It exits 1 when a feature's proof cannot prove it: the proof or an
entry is not in the head commit, the proof does not parse, or it
imports none of the feature's entries. An import counts when it is a
runtime `import`, `export ... from` or `export * from` of a relative
path that names an entry: by its own name, by the `.js`, `.jsx`, `.mjs`
or `.cjs` spelling of it, `.js` naming a `.tsx` entry as well as a
`.ts` one, or without an extension, the way a directory `index` is
imported. `import type` does not count, and neither does a
path alias. The proof runs in `bun run test` like any end-to-end test,
which is what shows it passes.

```
feature-owners: 1 problem(s) with the features' runnable proofs:
  billing: proof tests/e2e/billing.test.ts imports none of its entries, src/billing/index.ts
```

With `changeSignal` set to `advisory` it also lists each owner the
range touches, with the paths it touched under the owner's root or at
its proof, and still exits 0. Whether a change that spans owners is one
coherent slice is for a reviewer to judge. A rename counts at both of
its paths:

```
feature-owners: advisory, the range touches 2 feature owner(s); a reviewer judges whether they make one slice:
  billing: src/billing/charge.ts, src/billing/tax.ts
  invoices: src/invoices/tax.ts, tests/e2e/invoices.test.ts
```

It exits 2 when `quality.json` does not decode, which is where a proof
outside `tests/e2e/` is refused, or a ref does not resolve. A
repository that declares no feature passes, and `quality.json` refuses
a `changeSignal` without features, which would map a change to no
owner.

`checks-lint` runs it over each pull request's range.
See "Run every lint gate".

## Hold docs to their templates

`checks-docs` holds each doc file a change touches to the template for its kind, and lists every other doc file that does not conform yet without failing.
The package ships one template per kind under `templates/`, and a repository starts a new doc file by copying one:

```sh
cp node_modules/@avi2dg/checks/templates/how-to.md docs/add-a-supplier.md
```

| File | Kind | Template |
| --- | --- | --- |
| `README.md` | readme | `templates/readme.md` |
| `CHANGELOG.md` | changelog | `templates/changelog.md` |
| `AGENTS.md` | agents | `templates/agents.md` |
| `CLAUDE.md` | claude | `templates/claude.md` |
| `CONTRIBUTING.md` | how-to | `templates/how-to.md` |
| each file in `docs/adr/` but its generated index, `README.md` | adr | `templates/adr.md` |
| a page `docs.pages` declares | tutorial, how-to, reference or explanation | `templates/<mode>.md` |

The first five are the files at the repository root.
No other Markdown file is judged, save a page under `docs/`, which needs a mode.
Which Diátaxis mode a page is written in is a judgment, so `quality.json` declares it:

```json
"docs": {
  "pages": {
    "reference": ["docs/gates/*.md"],
    "explanation": ["docs/design.md"]
  }
}
```

A template decides a file's structure, and the template file itself is the reference for each kind:

- A file opens with one `# ` title on its first line and has text before its first section.
  It skips no heading level, and no heading is Overview, Introduction or How it works.
- Its sections are the template's headings in the template's order.
  A heading in angle brackets is one the writer names.
  One marked verb first is left to review, since no program tells a verb from a noun there.
  A heading the template does not have, in that place, is refused.
- A record in `docs/adr/` is named for its four-digit number, and its title opens with the same number.
  A `Date: YYYY-MM-DD` line follows the title, the first word under Status is Proposed, Accepted, Rejected, Deprecated, Superseded or Retired, and no other record holds its number.
- A changelog lists its releases newest first, each opening with a `Released YYYY-MM-DD.` line.
- A how-to or tutorial page numbers its steps.
- `CLAUDE.md` is its template word for word.

```sh
checks-docs <base-ref> <head-ref>
checks-docs <ref>
```

It reads each file from the head commit.
With two arguments the range starts where the head branched from the base, at their merge-base.
With one it is that commit against its parent, or against the empty tree for a repository's first commit.
A file the range adds, changes or renames is held to its template, and a file it deletes is not.

```
docs: 2 violation(s) in the doc files the range touches:
  README.md:1: lacks `## Where things are`
  docs/parts.md: is a page under docs/ with no mode; declare it under docs.pages in quality.json as tutorial, how-to, reference, explanation
docs: advisory, 1 doc file(s) the range leaves alone do not hold to their templates yet:
  docs/adr/0001-quality-gates.md: 5 violation(s)
```

It exits 1 on a violation in a file the range touches, and 2 when `quality.json` does not decode or a ref does not resolve.

`checks-lint` runs it over each pull request's range.
See "Run every lint gate".

## Check the CI wiring

`checks-ci-wiring` fails when a command the repository's CI must run no
longer runs on pull requests to the default branch. No local check sees
that: a workflow whose lint step became a no-op leaves `bun run lint`
green.

The repository declares its gates once, in `quality.json`:

```json
"gates": {
  "ci": ["bun run lint", "bun run typecheck", "bun run test"]
}
```

and `package.json` runs the check through `checks-lint`:

```json
"scripts": {
  "lint": "oxlint --type-aware && checks-lint"
}
```

It parses every `.github/workflows/*.yml` and `*.yaml` and looks, for
each gate, for a `run:` step that is the gate command alone on one line,
optionally followed by plain arguments: words, quoted strings, and
`$VAR` or `${VAR}` expansions. `bun run lint --quiet` and
`bunx checks-comment-gate "origin/$BASE_REF" "$HEAD_SHA"` count;
`bun run lint:deps`, `echo bun run lint` and a step `name:` do not. A
step whose script has a second line, or any `|`, `||`, `&&`, `;`, `&`,
`$(...)`, backticks, `<` or `>` redirection, a comment or a leading
`NAME=value`, never counts, because each can run the gate without its
failure failing the step; the report names the gate and says to give it
its own step with nothing else in it. A gate step counts only when:

- its workflow triggers on `pull_request`, any `branches` or
  `branches-ignore` filter there keeps the default branch, any `types`
  filter keeps `opened` and `synchronize`, and it sets no `paths` or
  `paths-ignore` filter, which lets some pull requests skip the gate;
- neither the step nor its job sets `if: false` or
  `continue-on-error: true`, bare or as `${{ false }}` and `${{ true }}`;
- its job needs no job, directly or through a chain, that sets
  `if: false`, unless a job on that chain has an `if:` calling
  `always()`, `failure()` or `cancelled()`. GitHub prefixes every other
  `if:`, including `true` and `success()`, with `success()`, so a job
  whose needed job was skipped is skipped too.

A job calling a local reusable workflow (`uses: ./.github/workflows/x.yml`)
passes its own trigger and `if:` down to the called workflow's steps.
A remote reusable workflow (`uses: owner/repo/...@ref`) is not a
supported way to wire a gate: it is not read, so a gate must run as a
`run:` step, such as `bunx checks-comment-gate`, in the repo's own
workflows.

A step running `checks-lint` also counts for a declared gate that calls
one of the gates `checks-lint` runs by its bare bin name, when the step
calls `checks-lint` the same way: `bunx checks-lint` counts for
`bunx checks-comment-gate "origin/$BASE_REF" "$HEAD_SHA"`. A step running `bun run lint` counts only for the `bun run lint` gate,
since the check never reads what a package script runs. So once `lint`
runs `checks-lint`, the per-gate entries can leave `gates.ci`
along with the workflows that ran them.

The default branch is `main`; a repo with another one sets
`"defaultBranch"` in `quality.json`, which `checks-lint` also reads when
`origin/HEAD` is not set.

It exits 1 naming each gap, with every step that runs the gate and why
that step does not count:

```
ci-wiring: 1 of 8 gate(s) do not run on pull requests to main:
  bun run lint
    .github/workflows/release.yml job publish step 7: .github/workflows/release.yml does not trigger on pull_request
```

It exits 2 when `quality.json` declares no `gates.ci` or does not
decode, a gate or scheduled command is not one plain command, or a
workflow does not parse. Whether a workflow is well formed is
actionlint's question, not this one's.

A command a schedule must run, such as the flake run, goes in
`gates.scheduled`:

```json
"gates": {
  "ci": ["bun run lint", "bun run typecheck", "bun run test"],
  "scheduled": ["bunx checks-flake --runs 10 --report flake-report.json"]
}
```

Each counts only as a step of the same plain shape in a workflow whose
`on` carries `schedule` with at least one `cron`, under the same
`if: false`, `continue-on-error: true` and `needs` rules as a gate. It
exits 1 naming each one no schedule runs:

```
ci-wiring: 1 of 1 scheduled command(s) do not run on a schedule:
  bunx checks-flake --runs 10 --report flake-report.json
    .github/workflows/ci.yml job checks step 5: .github/workflows/ci.yml does not trigger on a schedule
```

### Gate selection

A repository with no TypeScript source gives `checks-lint-coverage`,
`checks-test-layout`, `checks-size-budget` and `checks-feature-owners`
nothing to check, and test-layout still refuses its
missing `bun test` script and `bunfig.toml`. It declares the gates
`checks-lint` runs as `gates.lint`:

```json
"gates": {
  "ci": ["bun run lint"],
  "lint": [
    "checks-commit-identity",
    "checks-comment-gate",
    "checks-suppressions-ratchet",
    "checks-ci-wiring",
    "checks-docs",
    "checks-quality"
  ]
}
```

`checks-lint` runs exactly those, in the "Run every lint gate" table's
order, and all ten when `gates.lint` is absent. A selection in
`quality.json` always keeps `checks-quality`, since the file it sits in
is what makes that gate apply. A step running
`checks-lint` then counts only for a declared gate that `gates.lint`
keeps.

A selection may leave out only a gate that does not apply:

| Gate | Applies when the repository |
| --- | --- |
| `checks-lint-coverage` | tracks a `.ts` or `.tsx` file |
| `checks-test-layout` | tracks a `.ts` or `.tsx` file |
| `checks-commit-identity` | always |
| `checks-comment-gate` | always |
| `checks-suppressions-ratchet` | always |
| `checks-ci-wiring` | always |
| `checks-docs` | always |
| `checks-quality` | tracks a `quality.json` |
| `checks-size-budget` | tracks a `.ts` or `.tsx` file |
| `checks-feature-owners` | tracks a `.ts` or `.tsx` file |

Both bins exit 2 on a `gates.lint` that names an unknown gate or leaves
out one that always applies. ci-wiring exits 1 when the
selection leaves out a gate the repository's tracked files make
applicable, and names the gate and the files:

```
ci-wiring: quality.json gates.lint leaves out 4 gate(s) this repository's contents make applicable:
  checks-lint-coverage: the repository tracks TypeScript source (src/widget.ts)
  checks-test-layout: the repository tracks TypeScript source (src/widget.ts)
  checks-size-budget: the repository tracks TypeScript source (src/widget.ts)
  checks-feature-owners: the repository tracks TypeScript source (src/widget.ts)
```

It reads the files tracked at the checkout, so the pull request that
adds the first TypeScript file is the one refused.

### Limits

The check reads workflow files and never runs them, so it deliberately
does not evaluate:

- an `if:` expression other than a constant `true` or `false`, which
  counts as running;
- a `strategy.matrix` `include` or `exclude`, so a matrix that drops
  every combination still counts as running its steps;
- a remote reusable workflow (`uses: owner/repo/...@ref`), whose steps
  are never read;
- anything that happens at run time on the runner: what the gate
  command itself does, the shell's options, and a step or job that
  fails or times out before the gate step.

## Backtest the comment check

`scripts/backtest.ts` reports what the comment check would have refused
at each recent commit, so a repository can measure its own history:

```sh
bun run checks-backtest [commit-count]
```

It walks the last `commit-count` first-parent commits, 60 by default,
prints a row per commit that touches code and then the totals,
attributes only the refusals each commit introduced, and counts new
comment text as a share of added lines.
`generated/`, `vendor/`, `repos/`, `node_modules/` and `dist/` are out
of reach, so the figures are authored code.

## Compare mutation scores

`checks-mutation-compare` gates a pull request on no-regression rather
than an absolute threshold: the head mutation score may not fall below
the score at the merge-base.

```sh
checks-mutation-compare <base-report> <head-report> [--advisory]
```

Both reports are Stryker `mutation.json` files. It prints the overall
score of each report and the per-file scores that differ, and exits 1
when the head score is below the base score. The score is Stryker's:
`Killed` and `Timeout` over those plus `Survived` and `NoCoverage`, so
`CompileError`, `RuntimeError`, `Ignored` and `Pending` mutants leave
it. Every file in a report counts toward that report's score, including
files present in only one of the two.

`--advisory` prints the same verdict and always exits 0. That is how
consumers run it for the first month; after that they drop the flag and
it blocks.

Enforcement runs on pull requests, comparing the head report against a
report built at the merge-base:

```yaml
jobs:
  mutation-compare:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bunx stryker run
      - run: |
          base="$(git merge-base HEAD origin/main)"
          git worktree add /tmp/mutation-base "$base"
          (cd /tmp/mutation-base && bun install --frozen-lockfile && bunx stryker run)
      - run: bun run checks-mutation-compare --advisory /tmp/mutation-base/reports/mutation/mutation.json reports/mutation/mutation.json
```

The shared Stryker preset's `json` reporter writes
`reports/mutation/mutation.json` in each worktree.

## Develop

```sh
bun install
bun run build
bun run lint
bun run typecheck
bun run test
```

Release by tagging a commit on `main`. The `release` workflow refuses
a tag off `main` and reruns the build, `dist/` check, lint, typecheck
and tests before it publishes:

```sh
tag="v$(bun -p 'require("./package.json").version')"
git tag "$tag" && git push origin "$tag"
```

The `release` workflow publishes the tagged version through npm
trusted publishing, so the tag and `package.json` must agree. No
token is stored anywhere: GitHub mints the publish credential for
each run.

npm attaches a trusted publisher only to a package that already
exists, so the first version goes out by hand: `npm publish` from the
tagged commit as `avi2dg`, then add the trusted publisher (repository
`avi2d/checks`, workflow `release.yml`) in the package's npm settings.
That first tag's `release` run fails on the already-published version;
every later tag publishes through the workflow.

`publishConfig.access` in package.json is what makes the scoped package
public.

## Where things are

| Path | What it holds |
| --- | --- |
| `scripts/` | every bin, and the modules they share |
| `effect-channel/` | the Effect error-channel oxlint plugin |
| `dist/` | the committed bundles of the plugin and of `featureRules` |
| `presets/` | the Effect presets `checks-quality` builds its fragments from |
| `templates/` | one template per kind of doc file, which `bun run build` renders |
| `tests/` | the suite, with the tests that spawn a process under `tests/e2e/` |
| `docs/` | pages for whoever develops the kit |
| the root configs | `oxlintrc.json`, `tsconfig.effect.json`, `bunfig.toml`, `commitlint.config.js`, `dependency-cruiser.config.js`, `stryker.preset.js` and `quality.schema.json`, which a consuming repository extends or copies |

## Related topics

- [Why it is shaped this way](docs/design.md)
