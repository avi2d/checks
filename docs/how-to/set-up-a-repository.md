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
     "compilerOptions": { "types": ["bun"] }
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

1. Write `dependency-cruiser.config.ts` only when the kit's import rules need an entry point or a boundary of the repository's own:

   ```ts
   import { defineConfig } from "@avi2dg/checks/dependency-cruiser";

   export default defineConfig({ orphans: ["^src/bin[.]ts$"] });
   ```

## Run the checks on every pull request

To run the gates in CI:

1. Add scripts to `package.json`, replacing the build entry with the repository's own build command:

   ```json
   "build": "bun build src/index.ts --outdir dist --target node && checks-effect-scope",
   "lint": "oxlint && checks-lint",
   "typecheck": "tsc --noEmit && effect-tsgo diagnostics --project tsconfig.json --format text --strict",
   "test": "checks-test"
   ```

1. Run the scripts on every pull request in `.github/workflows/ci.yml`, fetching the whole history the range needs:

   ```yaml
   on:
     pull_request:
   jobs:
     checks:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v5
           with:
             fetch-depth: 0
         - uses: oven-sh/setup-bun@v2
           with:
             bun-version-file: .bun-version
         - run: bun install --frozen-lockfile
         - run: bun run build
         - run: git diff --exit-code
         - run: bun run lint
         - run: bun run typecheck
         - run: bun run test
   ```

Lint the pull request title in the same job with one step:

   ```yaml
         - id: title
           name: lint the title
           env:
             PR_TITLE: ${{ github.event.pull_request.title }}
             GH_TOKEN: ${{ github.token }}
           run: bunx checks-commit-title
   ```

A repository whose branch protection requires a `commitlint` status reports the title step under that name using the following step.
The same job reports the title step's outcome under that name on every run, which needs `statuses: write`:

   ```yaml
         - name: report the title as commitlint
           if: always()
           env:
             GH_TOKEN: ${{ github.token }}
             HEAD_SHA: ${{ github.event.pull_request.head.sha }}
             OUTCOME: ${{ steps.title.outcome }}
           run: |
             state=failure
             if [ "$OUTCOME" = success ]; then state=success; fi
             gh api "repos/$GITHUB_REPOSITORY/statuses/${HEAD_SHA:-$GITHUB_SHA}" -f state="$state" -f context=commitlint -f target_url="$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID" --silent
   ```

A private repository sets `runs-on: ${{ vars.CI_RUNS_ON || 'ubuntu-latest' }}` on each job, as [checks-ci-wiring](../gates/checks-ci-wiring.md#runners) requires.
`checks-effect-scope` writes the Effect paths of `oxlint.config.ts` and the kit's severities into `tsconfig.json`, as [The Effect rules](../configs/effect-rules.md#language-service) says.
`bun run lint` then ends with `checks-lint: <count> gate(s) pass`.

## Related topics

- [The bins](../bins.md)
- [Native settings](../configs/native-settings.md)
- [The Effect rules](../configs/effect-rules.md)
- [The TypeScript rules](../configs/typescript-rules.md)
- [The dependency rules](../configs/dependency-rules.md)
- [The commit message lint](../configs/commit-messages.md)
