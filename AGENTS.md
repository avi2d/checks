# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.
- `dist/` is committed because no `prepack`/`prepublishOnly` builds it at publish time, so the tarball ships the committed bundle; rebuild with `bun run build`. See README.md "Why it is shaped this way".
- Consumer `.oxlintrc.json` must restate `plugins`: oxlint does not inherit them through `extends`.
- `bun run lint` also cruises dependencies via `.dependency-cruiser.cjs`, which extends the shared base; new root-level source files must join the cruise scope in the `lint` script or they go unchecked.
- `scripts/test-layout.ts` decides this repo's own test layout too, so a new test goes under `tests/**/*.test.ts` and anything that spawns, shells out, or reaches the network goes under `tests/e2e/`. README "Test layout" carries the standard.
- `package.json` `ciWiring.gates` lists the commands CI must run on pull requests, and `bun run lint` fails when a workflow edit drops or disables one; a new CI gate step joins that list.
- `bunfig.toml` is at once this repo's config and the preset consumers copy, because bun has no bunfig `extends`. Editing it changes every consumer's required file.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
