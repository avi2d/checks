# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.
- `bun run build` writes every generated file this repo commits, `dist/`, `quality.schema.json`, `templates/` and `CHANGELOG.md`, and CI fails when the tree differs after it. Run it under the bun `.bun-version` pins, because CI rebuilds with that bun and another version emits different bytes. `CHANGELOG.md` comes from the conventional commits between `v*` tags, so it is never edited by hand; README "Develop" carries the release steps and docs/design.md the reasons.
- Every oxlint config in an `extends` chain sets `plugins`, the consumer's and a generated fragment alike: one without them brings oxlint's default plugins, and their category rules, into the whole tree.
- `scripts/test-layout.ts` decides this repo's own test layout too, so a new test goes under `tests/**/*.test.ts` and anything that spawns, shells out, or reaches the network goes under `tests/e2e/`. README "Lay out the tests" carries the standard.
- `quality.json` `gates.ci` lists the commands CI must run on pull requests, and `bun run lint` fails when a workflow edit drops or disables one; a new CI gate step joins that list.
- `quality.json` `sources.effect` is the one statement of the Effect-required paths. After editing it or a file in `presets/`, `bun scripts/quality.ts generate` rewrites the committed root fragments `.oxlintrc.json` and `tsconfig.json` extend; after editing the schema in `scripts/quality-file.ts`, `bun run build` rewrites `quality.schema.json` and `dist/feature-rules.js`, which bundles the schema. Lint, the suite and CI's diff after the build fail on any of them left stale.
- `@oxlint/plugins` ships no RuleTester, so each `effect-channel` rule is proven red and green against an installed consumer in `tests/e2e/consumer.test.ts`.
- `bunfig.toml` is at once this repo's config and the preset consumers copy, because bun has no bunfig `extends`. Editing it changes every consumer's required file.
- Effect is required in `scripts/`, the bins and the modules they import: IO goes through Effect's `FileSystem` and `ChildProcess` (`scripts/git.ts`), a bin runs through `runMain` in `scripts/main.ts`, and failures are `Schema.TaggedError`s. `effect-channel/` is exempt because oxlint loads it without `node_modules`, and so is `scripts/comment-matchers.ts`, which a host copies alone into a hook bundle; `.dependency-cruiser.cjs` holds it to importing nothing, so Effect wrappers go in `scripts/comments.ts`. `scripts/feature-rules.ts` is exempt through `sources.effect.exempt`, since a `.cjs` dependency-cruiser config calls it synchronously; this repo's own config requires its `dist/` bundle. Tests stay plain `bun:test`, running an effect with `Effect.runSync` or `Effect.runPromise` where they call it. `quality.json` declares the path, and the generated root fragments enforce it.
- `oxlint-suppressions.json` is oxlint's generated baseline for the Effect override in `oxlintrc.quality.json`, and a test refuses any other rule or path in it. A fixed site fails lint until `oxlint --type-aware --prune-suppressions`; `--suppress-all` accepts a new site, so it is a review decision, never a repair.
- `quality.json` `size` holds every production file a branch adds or changes to 400 lines and 100 per function through `bun run lint`; the advisory list the gate prints names the files already over, which a change to one of them has to bring under.
- `checks-docs` runs in `bun run lint`, so an edit to `README.md`, `AGENTS.md`, `CLAUDE.md` or a page under `docs/` leaves the whole file holding to its template in `templates/`, and a new page under `docs/` gets its mode in `quality.json` `docs.pages`. `templates/` is rendered from `scripts/doc-templates.ts` by `bun run build`, and a test fails on a stale one.
- CI runs the suite inside a pull request, so a test that spawns `checks-lint` passes it `withoutPullRequestEvent()` from `tests/lib/env.ts`; otherwise the real event decides the range, green locally and red on CI.
- `bun run test` is `checks-test` (`scripts/test.ts`), which fails on a skip `package.json` `testSkips` does not declare; a test that spawns `checks-test` sets `CI` itself, and one that spawns `checks-flake` sets or drops `GITHUB_STEP_SUMMARY`, or CI's own values decide which declarations hold and where the summary lands.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows.
Point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
