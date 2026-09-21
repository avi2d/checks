# checks

Deterministic checks shared across my TypeScript repos. One package,
`@avi2d/checks`: the oxlint base config, the tsconfig fragment with the
Effect language-service block, the shared commitlint config, and the
Effect error-channel plugin compiled to JavaScript.

Consumed by a `file:` dependency on the local checkout. No npm publish.

## Consume it

From the consuming repo, with this checkout beside it:

```sh
bun add -d file:../checks oxlint@1.83.0 oxlint-tsgolint@7.0.2002 @effect/tsgo@0.45.0 typescript@7.0.2 dependency-cruiser@18.4.0
```

`.oxlintrc.json`:

```json
{
  "extends": ["./node_modules/@avi2d/checks/oxlintrc.json"],
  "plugins": ["typescript", "oxc", "eslint", "import"],
  "ignorePatterns": ["node_modules/**"]
}
```

`tsconfig.json` gains one line:

```json
{
  "extends": "@avi2d/checks/tsconfig.effect.json"
}
```

`package.json` gains two scripts:

```json
"lint": "oxlint --type-aware && ./node_modules/@avi2d/checks/scripts/lint-coverage.sh",
"typecheck": "tsc --noEmit && effect-tsgo diagnostics --project tsconfig.json --format text --strict"
```

`lint-coverage.sh` fails when oxlint silently skips a tracked `.ts` or
`.tsx` file, for example through a stray `.gitignore` entry. It compares
`git ls-files` against oxlint's own file walk and names the missing files.

The lockfile pins nothing for the `file:` dependency, so a change here
reaches a consumer on its next `bun install`.

## Dependency rules

`.dependency-cruiser.cjs` extends the shared base, which carries
`no-circular`, `no-orphans`, `not-to-dev-dep` (shipped source importing
a dev-only package), and `no-deep-imports` (a subpath past a package
entry into its internals):

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

## Why it is shaped this way

- `plugins` does not inherit through oxlint `extends`. `rules`,
  `categories` and `jsPlugins` do. That is why the consumer snippet
  restates `plugins` and nothing else.
- The plugin ships compiled as `dist/index.js`, built with
  `bun build effect-channel/index.ts --outdir dist --target node --format esm`.
  Node refuses to type-strip a `.ts` plugin under `node_modules`, so the
  `.ts` source would fail to load from an installed package.
- `dist/` is committed. Bun runs no lifecycle script on a `file:` install,
  so a consumer would otherwise get no `dist/`. Rebuild it after pulling
  with `bun run build`; CI fails when the committed bundle is stale.
- `no-deep-imports` allows index leaves. A bare import can resolve to a
  nested entry such as `lib/index.js`, which is the public entry rather
  than a deep import, and the two are indistinguishable by resolved path.
- dependency-cruiser `extends` merges same-name `forbidden` rules with the
  child's fields winning. That is the entry-point and layer recipe above.

## Develop

```sh
bun install
bun run build
bun run lint
bun run typecheck
bun test
```
