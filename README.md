# checks

Deterministic checks shared across my TypeScript repos. One package,
`@avi2d/checks`: the oxlint base config, the tsconfig fragment with the
Effect language-service block, and the Effect error-channel plugin
compiled to JavaScript.

Consumed by a `file:` dependency on the local checkout. No npm publish.

## Consume it

From the consuming repo, with this checkout beside it:

```sh
bun add -d file:../checks oxlint@1.83.0 oxlint-tsgolint@7.0.2002 @effect/tsgo@0.45.0 typescript@7.0.2
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
"lint": "oxlint --type-aware",
"typecheck": "tsc --noEmit && effect-tsgo diagnostics --project tsconfig.json --format text --strict"
```

The lockfile pins nothing for the `file:` dependency, so a change here
reaches a consumer on its next `bun install`.

## Why it is shaped this way

- `plugins` does not inherit through oxlint `extends`. `rules`,
  `categories` and `jsPlugins` do. That is why the consumer snippet
  restates `plugins` and nothing else.
- The plugin ships compiled as `dist/index.js`, built with
  `bun build effect-channel/index.ts --outdir dist --target node --format esm`.
  Node refuses to type-strip a `.ts` plugin under `node_modules`, so the
  `.ts` source would fail to load from an installed package.
- `dist/` is committed. Bun does not run `prepare` on a `file:` install,
  so a consumer would otherwise get no `dist/`. Rebuild it after pulling
  with `bun run build`; CI fails when the committed bundle is stale.

## Develop

```sh
bun install
bun run build
bun run lint
bun run typecheck
bun test
```
