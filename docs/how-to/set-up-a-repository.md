---
kind: how-to
audience: consumers
---
# Set up a repository

A repository owner follows these steps once, after [Install](../../README.md#install), so each gate `checks-lint` runs finds the file it reads.

## Before you begin

- The kit in `devDependencies` and the kit's `.bun-version` copied, as [Install](../../README.md#install) says.

## Write the tool configs

To give each tool the config it reads:

1. Write `oxlint.config.ts` with the kit's builder, saying whether the sources are Effect programs:

   ```ts
   import { defineConfig } from "@avi2dg/checks/oxlint";

   export default defineConfig({ effect: true });
   ```

1. Keep oxlint out of `node_modules/` through `.gitignore`:

   ```
   node_modules/
   ```

1. Add the Bun types, which the kit's config builders need to typecheck:

   ```sh
   bun add -d @types/bun
   ```

1. Extend the tsconfig fragment in `tsconfig.json`, naming the Bun types:

   ```json
   {
     "extends": "@avi2dg/checks/tsconfig.effect.json",
     "compilerOptions": { "types": ["bun"], "allowImportingTsExtensions": true, "noEmit": true }
   }
   ```

1. Copy the bunfig preset:

   ```sh
   cp node_modules/@avi2dg/checks/bunfig.toml bunfig.toml
   ```

1. Name the files nothing imports in `knip.config.ts`:

   ```ts
   import { defineConfig } from "@avi2dg/checks/knip";

   export default defineConfig({ entry: ["src/index.ts"] });
   ```

1. Measure `src` for repetition in `.jscpd.json`:

   ```json
   {
     "path": ["src"],
     "format": ["typescript"],
     "ignore": ["**/*.d.ts"]
   }
   ```

1. Write `dependency-cruiser.config.ts` only when the kit's import rules need an entry point or a boundary of the repository's own:

   ```ts
   import { defineConfig } from "@avi2dg/checks/dependency-cruiser";

   export default defineConfig({ orphans: ["^src/bin[.]ts$"] });
   ```

## Write the root docs

To give the kit and each agent the files they read:

1. Copy the agent templates to the repository root:

   ```sh
   cp node_modules/@avi2dg/checks/dist/templates/agents.md AGENTS.md
   cp node_modules/@avi2dg/checks/dist/templates/claude.md CLAUDE.md
   ```

1. Fill `AGENTS.md` with what an agent cannot infer from the code.
1. Keep `CLAUDE.md` word for word, so Claude Code reads `AGENTS.md`.
1. If `VISION.md` does not exist, copy the vision template to the repository root:

   ```sh
   cp node_modules/@avi2dg/checks/dist/templates/vision.md VISION.md
   ```

1. Fill the new page's opening, stance sections, Scope and closing lines.
1. Name `VISION.md` once in `AGENTS.md`.
1. If `CHANGELOG.md` does not exist, create it at the repository root with this title and lead:

   ```md
   # Changelog

   Every release of `<package>`, newest first, written by the release from its conventional commits.
   ```

   Replace `<package>` with the name in `package.json`.
   Keep an existing changelog unchanged.

1. If `HEAD` has no `CHANGELOG.md`, commit the file before running the checks:

   ```sh
   git add CHANGELOG.md
   git commit -m "docs: add changelog"
   ```

   The release workflows require `CHANGELOG.md` in `HEAD`, so an untracked or staged file does not pass `checks-ci-wiring`.

## Run the checks on every pull request

To run the gates in CI:

1. Add scripts to `package.json`, replacing the build entry with the repository's own build command:

   ```json
   "build": "bun build src/index.ts --outdir dist --target node && checks-effect-scope",
   "lint": "oxlint && checks-lint",
   "typecheck": "tsc --noEmit && effect-tsgo diagnostics --project tsconfig.json --format text --strict",
   "test": "checks-test",
   "test:fast": "checks-test --changed"
   ```

   Each tier with test files also needs its `test:<tier>` script, as [checks-test-layout](../gates/checks-test-layout.md) says.

1. Write the workflow files for the repository kind:

   ```sh
   bunx checks-workflows --write
   ```

   The command writes the set [checks-workflows](../gates/checks-workflows.md) holds, and every file holds its own steps.
   A site with no site workflow yet passes its three names on the first write:

   ```sh
   bunx checks-workflows --write --pages acme --domain acme.example --production acme/acme.example
   ```

   A later `--write` keeps the names the site workflows hold.
   `ci.yml` composes the jobs that run side by side.
   A first write gives `ci.yml` the default test jobs of the kind.
   A code repository gets `unit` and, when `tests/e2e/` holds a test file, `e2e`.
   A site gets `unit`, `e2e` when present, and `browser`.
   To set what the browser job visits and checks, [write `checks.browser.config.ts`](../gates/checks-browser.md#what-it-reads).
   To run another test command, copy the `unit` job under a new name, change the `run` of its step with id `test`, and run `--write` again.
   A later `--write` keeps the test jobs `ci.yml` holds and rewrites the rest of the file.
   The `static` job fails the pull request when a workflow file differs or an extra one appears.
   A new repository gets the same files from [checks-setup](../gates/checks-setup.md).

The whole-tree gates run on demand through the `whole-tree-run.yml` that [checks-setup](../gates/checks-setup.md) and `checks-workflows --write` write in a site or code repository.
Start it with `gh workflow run whole-tree-run`, as [checks-whole-tree-run](../gates/checks-whole-tree-run.md#running-it-by-hand) says.
To run only the four gates from a local shell, run `bunx checks-lint --whole-tree`.

`checks-effect-scope` writes the Effect paths of `oxlint.config.ts` and the kit's severities into `tsconfig.json`, as [The Effect rules](../configs/effect-rules.md#language-service) says.
`bun run lint` then ends with `checks-lint: <count> gate(s) pass`.

## Related topics

- [The bins](../bins.md)
- [Native settings](../configs/native-settings.md)
- [The Effect rules](../configs/effect-rules.md)
- [The TypeScript rules](../configs/typescript-rules.md)
- [The dependency rules](../configs/dependency-rules.md)
- [The commit message lint](../configs/commit-messages.md)
