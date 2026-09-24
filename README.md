# checks

Deterministic checks shared across my TypeScript repos. One package,
`@avi2dg/checks`: the `checks-lint` entry point that runs every lint gate
below over a range it resolves itself, the `checks-test` entry point
that runs the suite and refuses an undeclared skip, the `checks-flake`
run that records the seeds a failing test fails with, the oxlint base config, the
tsconfig fragment with the Effect language-service block, the shared
commitlint config, the shared dependency-cruiser base, the test-layout
check with its bunfig preset, the commit-identity check, the comment
gate with its backtest, the oxlint suppressions ratchet, the Stryker
mutation-testing preset with its no-regression comparator, the CI-wiring
check, and the Effect error-channel plugin compiled to JavaScript.

Published as `@avi2dg/checks` on the public npm registry.

## Consume it

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
repository has not declared; see "Test entry point" below.

`checks-lint` runs every kit gate a lint needs; see "Lint entry point"
below. Three of them:

`lint-coverage.sh` fails when oxlint silently skips a tracked `.ts` or
`.tsx` file, for example through a stray `.gitignore` entry. It compares
`git ls-files` against oxlint's own file walk and names the missing files.
It exits 2 when oxlint cannot walk the tree, as when it is not on `PATH`
or its config does not parse.

`test-layout.ts` decides the test layout described below.

`commit-identity.ts` refuses a commit with an author other than the
repository owner; see "Commit identity" below.

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

## Lint entry point

`checks-lint` runs each of the kit's lint gates in turn and names every
one that fails, rather than stopping at the first. A repository whose
tracked files give a gate nothing to check can leave it out through
`ciWiring.lintGates`; see "Gate selection" under "CI wiring".

| Gate | Reads |
| --- | --- |
| `checks-lint-coverage` | the working tree |
| `checks-test-layout` | the working tree |
| `checks-commit-identity` | the range |
| `checks-comment-gate` | the range |
| `checks-suppressions-ratchet` | the range |
| `checks-ci-wiring` | the working tree |

```sh
checks-lint
checks-lint <base-ref> <head-ref>
```

It resolves the range once and hands the same one to every range gate.
Locally, and on any event other than a pull request, the range ends at
`HEAD` and starts where `HEAD` branched from the origin default branch:
`origin/HEAD`, or when `origin/HEAD` is not set, as in an
`actions/checkout` clone, `origin/<ciWiring.defaultBranch>` from the
repository's `package.json` (see "CI wiring"), and `origin/main` when
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
checks-lint: 3 of 6 gate(s) failed: checks-commit-identity, checks-comment-gate, checks-suppressions-ratchet
```

It exits 1 when any gate found a violation, and 2 when the range or the
selection does not resolve, or no failing gate could decide. ci-wiring
always runs, so a repository on `checks-lint` declares `ciWiring.gates`
(see "CI wiring"), and it holds the test layout unless its selection
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

## Effect rules

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

A repository turns them on for the paths it writes in Effect through an
`overrides` entry in its root `.oxlintrc.json`:

```json
{
  "extends": ["./node_modules/@avi2dg/checks/oxlintrc.json"],
  "plugins": ["typescript", "oxc", "eslint", "import"],
  "overrides": [
    {
      "files": ["src/**"],
      "rules": {
        "effect-channel/no-throw": "error",
        "effect-channel/no-try-catch": "error"
      }
    }
  ]
}
```

oxlint resolves `files` against the directory of the config that holds
the override, so a config passed with `-c` from outside the repository
matches nothing and reports nothing.

This repository's own override for `scripts/**` adds `node/no-sync`,
`oxc/no-async-await`, `promise/avoid-new` and `unicorn/no-process-exit`,
which need the `node`, `promise` and `unicorn` plugins in the override's
`plugins`. `unicorn/no-process-exit` passes over any file that opens with
a shebang, so a bin also needs `no-restricted-properties` on
`process.exit`. Sites standing when the override lands go in oxlint's own
baseline, `oxlint --suppress-all`, so their count can only fall.

The language service holds the same paths to Effect-native IO through
`overrides` in the plugin block of `tsconfig.json`. effect-tsgo keeps the
severities `tsconfig.effect.json` sets when the child config restates the
plugin with only its overrides:

```json
{
  "extends": "@avi2dg/checks/tsconfig.effect.json",
  "compilerOptions": {
    "plugins": [
      {
        "name": "@effect/language-service",
        "overrides": [
          {
            "include": ["src/**/*.ts"],
            "options": {
              "diagnosticSeverity": {
                "nodeBuiltinImport": "error",
                "asyncFunction": "error",
                "newPromise": "error",
                "extendsNativeError": "error"
              }
            }
          }
        ]
      }
    ]
  }
}
```

## Test layout

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
  (see "Test entry point"), and `scripts.lint` runs this check, itself or
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

## Test entry point

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
a declaration stale, and 2 when `testSkips` does not parse or bun passed without
writing its report. It takes no arguments: a `-t` filter reports every
test it leaves out as skipped and a path filter drops files a
declaration names, so a narrowed run is plain `bun test --randomize`
with the arguments. Files under `tests/quarantine/` are never run and so
never reported; see "Test layout".

## Flake run

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

and declares the step in `ciWiring.scheduled`, so `checks-ci-wiring`
fails once the schedule stops running it; see "CI wiring".

## Dependency rules

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
entry.

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

## Commit lint

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

## Commit identity

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
owners restates it in `package.json`:

```json
"commitIdentity": {
  "authors": [{ "name": "avi2d", "email": "avi2dg@gmail.com" }]
}
```

`checks-lint` runs it over each pull request's range; see "Lint entry point".

## Comment gate

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
three lines, licence headers excepted; `scripts/comments.ts` holds the
scanner the gate and the backtest share.

`checks-lint` runs it over each pull request's range; see "Lint entry point".

## Suppressions ratchet

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

`checks-lint` runs it over each pull request's range; see "Lint entry point".

## CI wiring

`checks-ci-wiring` fails when a command the repository's CI must run no
longer runs on pull requests to the default branch. No local check sees
that: a workflow whose lint step became a no-op leaves `bun run lint`
green.

The repository declares its gates once, in `package.json`, and `lint`
runs the check through `checks-lint`:

```json
"ciWiring": {
  "gates": ["bun run lint", "bun run typecheck", "bun run test"]
},
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
runs `checks-lint`, the per-gate entries can leave `ciWiring.gates`
along with the workflows that ran them.

The default branch is `main`; a repo with another one sets
`"defaultBranch"` beside `"gates"`, which `checks-lint` also reads when
`origin/HEAD` is not set.

A command a schedule must run, such as the flake run, goes in
`"scheduled"` beside `"gates"`:

```json
"ciWiring": {
  "gates": ["bun run lint", "bun run typecheck", "bun run test"],
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

It exits 1 naming each gap, with every step that runs the gate and why
that step does not count:

```
ci-wiring: 1 of 8 gate(s) do not run on pull requests to main:
  bun run lint
    .github/workflows/release.yml job publish step 7: .github/workflows/release.yml does not trigger on pull_request
```

It exits 2 when `package.json` declares no gates, a gate is not one
plain command, or a workflow does not parse. Whether a workflow is
well formed is actionlint's question, not this one's.

### Gate selection

A repository with no TypeScript source gives `checks-lint-coverage` and
`checks-test-layout` nothing to check, and test-layout still refuses its
missing `bun test` script and `bunfig.toml`. It declares the gates
`checks-lint` runs as `lintGates`, beside `gates`:

```json
"ciWiring": {
  "gates": ["bun run lint"],
  "lintGates": [
    "checks-commit-identity",
    "checks-comment-gate",
    "checks-suppressions-ratchet",
    "checks-ci-wiring"
  ]
}
```

`checks-lint` runs exactly those, in the "Lint entry point" table's
order, and all six when `lintGates` is absent. A step running
`checks-lint` then counts only for a declared gate that `lintGates`
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

Both bins exit 2 on a `lintGates` that names an unknown gate or leaves
out one that always applies. ci-wiring exits 1 when the
selection leaves out a gate the repository's tracked files make
applicable, and names the gate and the files:

```
ci-wiring: ciWiring.lintGates leaves out 2 gate(s) this repository's contents make applicable:
  checks-lint-coverage: the repository tracks TypeScript source (src/widget.ts)
  checks-test-layout: the repository tracks TypeScript source (src/widget.ts)
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

## Backtest

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

## Mutation compare

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

## Why it is shaped this way

- `plugins` does not inherit through oxlint `extends`. `rules`,
  `categories` and `jsPlugins` do. That is why the consumer snippet
  restates `plugins` and nothing else.
- `node_modules/` is excluded through the consumer's `.gitignore`, not
  `ignorePatterns`: oxlint still walks the installed package when only
  `ignorePatterns` names it.
- `files` in package.json is the published surface: `tests/`, `AGENTS.md`
  and the `.ts` plugin source never reach an install. npm adds
  `package.json`, `README` and `LICENSE` to the tarball whatever `files`
  says. `bun pm pack` builds the same tarball the registry serves, which
  is what the packed-tarball consumer e2e test installs.
- The plugin ships compiled as `dist/index.js`, built with
  `bun build effect-channel/index.ts --outdir dist --target node --format esm`.
  Node refuses to type-strip a `.ts` plugin under `node_modules`, so the
  `.ts` source would fail to load from an installed package.
- `dist/` is committed. No `prepack` or `prepublishOnly` builds it, so a
  publish ships whatever bundle the publishing worktree holds. Rebuild it
  after pulling with `bun run build`; CI fails when the committed bundle
  is stale.
- The base parses with swc because typescript 7 (tsgo) has no compiler
  API for dependency-cruiser to use. Without `@swc/core` installed the
  cruise silently skips every `.ts` file, so this repo's test asserts its
  own TypeScript is cruised.
- `bunfig.toml` has no `extends` and no include: bun ignores an unknown
  top-level key in silence, so a preset cannot be inherited and the
  consumer's copy is compared key by key against the installed one
  instead. `[test] pathIgnorePatterns` is a real bunfig key, and an empty
  `--path-ignore-patterns` flag overrides the file's own list.
- The Stryker preset is a JavaScript module, not JSON: Stryker 10 does
  not resolve `extends` in a JSON config, but a `.mjs` config that
  spreads an imported object consumes it. Keys the consumer sets after
  the spread win.
- The `.ts` bins are written in Effect, so `effect` is a peer dependency
  and `@effect/platform-bun`, which only the bins use, is a dependency.
  `@effect/platform-node-shared` is a direct dependency at the same exact
  version only to pin it: `@effect/platform-bun` asks for it with a `^`
  range, and a newer rc peers on a newer `effect` than consumers install,
  so all three move together.
- Each runnable script ships a `checks-` bin entry, so consumer
  `package.json` scripts call the short name, which the package manager
  puts on `PATH` only there; a shell runs it through `bun run`, which
  never falls back to the registry the way `bunx` does. The `.ts` checks
  keep a `bun` shebang, which needs no build step and no `dist/`
  entry, unlike the oxlint plugin that node loads.
- `checks-lint` runs each gate as its own bin in a child process rather
  than importing it, so a gate behaves the same called alone or through
  the entry point, and `lint-coverage.sh` stays a shell script. The
  gates run one at a time with their output passed straight through, so
  each report reads whole and in the table's order.
- A gate selection is checked against the repository's contents rather
  than trusted, so it cannot skip a gate that applies. ci-wiring does
  that check, which is why a selection without it, or without another
  gate that applies everywhere, is refused as `checks-lint` reads it:
  nothing would check the selection otherwise.
- `checks-test` runs bun itself rather than reading a report some other
  run left: a skip taken only on CI is visible only in CI's own run, and
  an earlier run's report may be stale or narrowed. It reads the JUnit
  report bun writes to a temporary directory, since bun has no other
  per-test output meant for a program.
- `checks-ci-wiring` runs inside `lint`, not in a workflow of its own:
  deleting the step that runs a check is the violation it catches, so the
  local `lint` is where it has to fail.
- Workflows are parsed with `Bun.YAML`, which the `bun` shebang already
  provides, so the check adds no dependency. It reads `on` as a string
  key, not as the YAML 1.1 boolean.
- `bun` counts as a built-in module. Nothing installed resolves it except
  `@types/bun`, which would otherwise make every runtime `bun` import look
  like a dev-only dependency.
- The pull request merge commit GitHub builds is authored by `GitHub
  <noreply@github.com>`, which commit-identity refuses as an author.
  `checks-lint` ends a pull request's range at the event's head sha, so
  the merge commit is never in it. A `lint` that calls
  `checks-commit-identity HEAD` itself checks out
  `github.event.pull_request.head.sha` instead of the default merge ref.
- `no-deep-imports` judges the import specifier, never the resolved file.
  The base honours `exports` maps, so a subpath the map publishes resolves
  and passes, one it omits fails to resolve and is reported, and a package
  without an `exports` map publishes every file. A bare import always
  passes whatever file its entry lives in. Setting your own
  `options.enhancedResolveOptions` replaces the base's, so restate
  `exportsFields` and `conditionNames` if you do.
- dependency-cruiser `extends` merges same-name `forbidden` rules with the
  child's fields winning. That is the entry-point and layer recipe above.

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
git tag v0.8.0 && git push origin v0.8.0
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
