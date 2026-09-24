# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.
- `dist/` is committed because no `prepack`/`prepublishOnly` builds it at publish time, so the tarball ships the committed bundle; rebuild with `bun run build`. See README.md "Why it is shaped this way".
- Consumer `.oxlintrc.json` must restate `plugins`: oxlint does not inherit them through `extends`.
- `scripts/test-layout.ts` decides this repo's own test layout too, so a new test goes under `tests/**/*.test.ts` and anything that spawns, shells out, or reaches the network goes under `tests/e2e/`. README "Test layout" carries the standard.
- `package.json` `ciWiring.gates` lists the commands CI must run on pull requests, and `bun run lint` fails when a workflow edit drops or disables one; a new CI gate step joins that list.
- `@oxlint/plugins` ships no RuleTester, so each `effect-channel` rule is proven red and green against an installed consumer in `tests/e2e/consumer.test.ts`.
- `bunfig.toml` is at once this repo's config and the preset consumers copy, because bun has no bunfig `extends`. Editing it changes every consumer's required file.
- Effect is required in `scripts/`, the bins and the modules they import: IO goes through Effect's `FileSystem` and `ChildProcess` (`scripts/git.ts`), a bin runs through `runMain` in `scripts/main.ts`, and failures are `Schema.TaggedError`s. `effect-channel/` is exempt because oxlint loads it without `node_modules`, and tests stay plain `bun:test`, running an effect with `Effect.runSync` or `Effect.runPromise` where they call it. The `scripts/**` overrides in `.oxlintrc.json` and `tsconfig.json` enforce it.
- `oxlint-suppressions.json` is oxlint's generated baseline for the `scripts/**` override, and a test refuses any other rule or path in it. A fixed site fails lint until `oxlint --type-aware --prune-suppressions`; `--suppress-all` accepts a new site, so it is a review decision, never a repair.
- CI runs the suite inside a pull request, so a test that spawns `checks-lint` passes it `withoutPullRequestEvent()` from `tests/lib/env.ts`; otherwise the real event decides the range, green locally and red on CI.
- `bun run test` is `checks-test` (`scripts/test.ts`), which fails on a skip `package.json` `testSkips` does not declare; a test that spawns `checks-test` sets `CI` itself, and one that spawns `checks-flake` sets or drops `GITHUB_STEP_SUMMARY`, or CI's own values decide which declarations hold and where the summary lands.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
