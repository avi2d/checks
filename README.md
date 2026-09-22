# checks

Deterministic checks shared across my TypeScript repos. One package,
`@avi2d/checks`: the oxlint base config, the tsconfig fragment with the
Effect language-service block, the shared commitlint config, the shared
dependency-cruiser base, the test-layout check with its bunfig preset,
the commit-identity check with its workflow, the comment gate with its
workflow and backtest, and the Effect error-channel plugin compiled to
JavaScript.

Consumed by a `file:` dependency on the local checkout. No npm publish.

## Consume it

From the consuming repo, with this checkout beside it:

```sh
bun add -d file:../checks oxlint@1.83.0 oxlint-tsgolint@7.0.2002 @effect/tsgo@0.45.0 typescript@7.0.2 dependency-cruiser@18.4.0 @swc/core@1.16.2
```

`.oxlintrc.json`:

```json
{
  "extends": ["./node_modules/@avi2d/checks/oxlintrc.json"],
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
  "extends": "@avi2d/checks/tsconfig.effect.json"
}
```

`bunfig.toml` is a copy of the shipped preset:

```sh
cp node_modules/@avi2d/checks/bunfig.toml bunfig.toml
```

`package.json` gains three scripts:

```json
"lint": "oxlint --type-aware && ./node_modules/@avi2d/checks/scripts/lint-coverage.sh && bun ./node_modules/@avi2d/checks/scripts/test-layout.ts && bun ./node_modules/@avi2d/checks/scripts/commit-identity.ts HEAD",
"typecheck": "tsc --noEmit && effect-tsgo diagnostics --project tsconfig.json --format text --strict",
"test": "bun test --randomize"
```

`lint-coverage.sh` fails when oxlint silently skips a tracked `.ts` or
`.tsx` file, for example through a stray `.gitignore` entry. It compares
`git ls-files` against oxlint's own file walk and names the missing files.

`test-layout.ts` decides the test layout described below.

`commit-identity.ts` refuses a commit with an author other than the
repository owner; see "Commit identity" below.

The lockfile pins nothing for the `file:` dependency, so a change here
reaches a consumer on its next `bun install`.

## Test layout

`bun ./node_modules/@avi2d/checks/scripts/test-layout.ts` fails unless the
repo holds this shape, and names the file and the path to move it to when
it does not:

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
- `scripts.test` is exactly `bun test --randomize` and `scripts.lint` runs
  this check.
- `bunfig.toml` carries every `[test]` key of the shipped preset with the
  same value. Other tables, and extra `[test]` keys, are the repo's own.

The in-process half is what a mutation run can mutate; `tests/e2e/**` is
excluded from a mutate scope by construction, because a subprocess kills
both the speed and the coverage signal a mutant needs.

The preset also skips `tests/quarantine/**` on a default run. A test that
turns flaky moves there, so the suite stays trustworthy, and the flake is
still run on demand:

```sh
bun test --path-ignore-patterns='' tests/quarantine
```

## Dependency rules

`.dependency-cruiser.cjs` extends the shared base, which carries
`no-circular`, `no-orphans`, `not-to-dev-dep` (shipped source importing
a dev-only package, which a package listed in `peerDependencies` too is
not), `not-to-unresolvable` (nothing installed answers the
specifier), and `no-deep-imports` (a subpath the package's exports map
does not publish):

```js
module.exports = {
  extends: "./node_modules/@avi2d/checks/dependency-cruiser.config.js",
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
`@avi2d/checks/commitlint.config.js`. It arrives with the `file:`
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
    uses: avi2d/checks/.github/workflows/commitlint.yml@main
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
bun ./node_modules/@avi2d/checks/scripts/commit-identity.ts <base-ref> <head-ref>
bun ./node_modules/@avi2d/checks/scripts/commit-identity.ts <ref>
```

With one argument it checks that commit alone, which is the form the
`lint` script above runs on `HEAD`. It refuses a commit whose author or
committer is outside the allowlist, and one whose trailer block carries
a `Co-authored-by:` trailer as git parses it, and it names the offending
commit and reason. Other trailers and prose mentioning an address in the
body are left alone. `GitHub <noreply@github.com>` is allowed as
committer only, since that is who writes a squash merge.

The allowlist defaults to `avi2d <avi2dg@gmail.com>`. A repo with other
owners restates it in `package.json`:

```json
"commitIdentity": {
  "authors": [{ "name": "avi2d", "email": "avi2dg@gmail.com" }]
}
```

Enforcement runs on pull requests, where the range from the base branch's
current tip to the head is visible:

```yaml
on:
  pull_request:
    types: [opened, edited, synchronize, reopened]
jobs:
  commit-identity:
    uses: avi2d/checks/.github/workflows/commit-identity.yml@main
```

The workflow fetches the consumer's full history and ranges from the
fetched base branch, not the event's recorded base sha, which GitHub
leaves stale once the base branch advances after the pull request opens.

## Comment gate

`scripts/comment-gate.ts` runs the comment check over a diff and fails
when an added line carries a banned comment:

```sh
bun ./node_modules/@avi2d/checks/scripts/comment-gate.ts <base-ref> <head-ref>
bun ./node_modules/@avi2d/checks/scripts/comment-gate.ts <ref>
```

With two arguments it diffs the base against the head. With one it diffs
that commit against its parent, and exits 2 when that parent is not in
the clone rather than widening to the whole tree, so a shallow checkout
running the one-argument form needs `fetch-depth: 2`. Only added lines
are checked, so a violation in a file the diff never touches stays
silent, and a refusal counts when any line of the comment carrying it was
added. The check refuses a machine-read directive, a record or ticket
pointer, a doc block, and a file opening with a rationale block over
three lines, licence headers excepted; `scripts/comments.ts` holds the
scanner the gate and the backtest share.

Enforcement runs on pull requests, where the range from the base branch's
current tip to the head is visible:

```yaml
on:
  pull_request:
    types: [opened, edited, synchronize, reopened]
jobs:
  comment-gate:
    uses: avi2d/checks/.github/workflows/comment-gate.yml@main
```

## Backtest

`scripts/backtest.ts` reports what the comment check would have refused
at each recent commit, so a repository can measure its own history:

```sh
bun ./node_modules/@avi2d/checks/scripts/backtest.ts [commit-count]
```

It walks the last `commit-count` first-parent commits, 60 by default,
prints a row per commit that touches code and then the totals,
attributes only the refusals each commit introduced, and counts new
comment text as a share of added lines.
`generated/`, `vendor/`, `repos/`, `node_modules/` and `dist/` are out
of reach, so the figures are authored code.

## Why it is shaped this way

- `plugins` does not inherit through oxlint `extends`. `rules`,
  `categories` and `jsPlugins` do. That is why the consumer snippet
  restates `plugins` and nothing else.
- `node_modules/` is excluded through the consumer's `.gitignore`, not
  `ignorePatterns`: oxlint still walks the installed package when only
  `ignorePatterns` names it.
- `files` in package.json guards only `bun pm pack` and a registry
  publish. A `file:` install links the whole checkout and ignores
  `files`, so a `file:` consumer receives `tests/`, `AGENTS.md` and the
  `.ts` plugin source too, and its `.gitignore` entry for `node_modules/`
  is the only thing keeping oxlint out of them.
- The plugin ships compiled as `dist/index.js`, built with
  `bun build effect-channel/index.ts --outdir dist --target node --format esm`.
  Node refuses to type-strip a `.ts` plugin under `node_modules`, so the
  `.ts` source would fail to load from an installed package.
- `dist/` is committed. Bun runs no lifecycle script on a `file:` install,
  so a consumer would otherwise get no `dist/`. Rebuild it after pulling
  with `bun run build`; CI fails when the committed bundle is stale.
- The base parses with swc because typescript 7 (tsgo) has no compiler
  API for dependency-cruiser to use. Without `@swc/core` installed the
  cruise silently skips every `.ts` file, so this repo's test asserts its
  own TypeScript is cruised.
- `bunfig.toml` has no `extends` and no include: bun ignores an unknown
  top-level key in silence, so a preset cannot be inherited and the
  consumer's copy is compared key by key against the installed one
  instead. `[test] pathIgnorePatterns` is a real bunfig key, and an empty
  `--path-ignore-patterns` flag overrides the file's own list.
- The layout check ships as `.ts` and is invoked with `bun`, which needs
  no build step and no `dist/` entry, unlike the oxlint plugin that node
  loads.
- `bun` counts as a built-in module. Nothing installed resolves it except
  `@types/bun`, which would otherwise make every runtime `bun` import look
  like a dev-only dependency.
- The pull request merge commit GitHub builds is authored by `GitHub
  <noreply@github.com>`, which commit-identity refuses as an author. A
  consumer that runs the check inside `lint` checks out
  `github.event.pull_request.head.sha` instead of the default merge ref,
  as this repo's `ci.yml` does.
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
