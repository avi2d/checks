---
kind: reference
audience: consumers
---
# Native settings

Put each setting in the file its tool reads.
Put the browser plan in `checks.browser.config.ts` and shared kit settings in `checks.config.ts`.

## Settings by file

| File | Setting | Reader |
| --- | --- | --- |
| `.github/workflows/*.yml` | Pull request commands, scheduled commands, runner labels, run steps | GitHub Actions, `checks-ci-wiring` and `checks-plain-steps` |
| `oxlint.config.ts` | Effect paths and their exemptions, ignore patterns, and any rule or budget the repository sets over the kit's defaults | oxlint, `checks-effect-scope` and `checks-lint-coverage` |
| `oxlint-suppressions.json` | The existing violations oxlint suppresses, per file and rule | oxlint and `checks-suppressions-ratchet` |
| `stylelint-suppressions.json` | The existing violations stylelint suppresses, per file and rule | stylelint, `checks-frontend-syntax` and `checks-suppressions-ratchet` |
| `exports-baseline.json` | The existing unused exports and types, per file, kind and name | `checks-graphwalk` |
| `.jscpd.json` | The `path` and `ignore` globs of the files repetition is measured in | jscpd and `checks-repetition` |
| `.jscpd-baseline.json` | The existing repeated lines, per file, for whole-tree scans | `checks-repetition` |
| `knip.config.ts` | The `entry` globs Knip traces unreferenced files from | Knip and `checks-graphwalk` |
| `stylelint.config.ts` | The Baseline target, the token files, the CSS families the repository turns on, and any stylelint rule the repository sets over the kit's families | `checks-frontend-syntax` |
| `dependency-cruiser.config.ts` | Entry points nothing imports, paths that may import dev dependencies, and import boundaries, when the kit's defaults do not fit | `checks-graphwalk` |
| `tsconfig.json` | Compiler options, and the Effect language service plugin whose `overrides` and kit severities `checks-effect-scope` writes, keeping every other key except the six scoped keys it removes from the top-level `diagnosticSeverity` | TypeScript and Effect language service |
| `checks.config.ts` | [The settings no tool file owns](#the-settings-file) | `checks-test`, `checks-ci-wiring`, `checks-workflows`, `checks-setup`, `checks-release-tag`, `checks-browser`, `checks-copy`, `checks-frontend-syntax`, `checks-lint`, `checks-lint-coverage`, `checks-local-tests`, `checks-flake`, `checks-mutation` and the Bun test preload |
| `checks.browser.config.ts` | The browser plan, affected routes, build command, and timings | `checks-browser` and `checks-ci changes` |
| `package.json` | `scripts` with the `checks-vendor` arguments in `prepare`, `author` and `contributors` | Bun, `checks-commit-identity` and `checks-vendor` |
| `bunfig.toml` | Test discovery, quarantine exclusion and the preload that guards agent runs | Bun and `checks-test-layout` |
| `stryker.conf.mjs` | Mutation settings | Stryker |
| Each page under `docs/` | Diátaxis mode in `kind` front matter, and `audience: consumers` on a page that speaks to a consuming repository | `checks-docs` |

Every page under `docs/` names its mode in `kind` front matter, whatever directory holds it.
A page whose front matter sets `audience: consumers` names commands that a consuming repository runs.
`checks-docs` skips the `bun run` commands on such a page, and resolves those in every other living doc or agent file as [Paths, links and commands](../gates/checks-docs.md#paths-links-and-commands) says.

## The config builders

The kit ships a `defineConfig` for oxlint, Knip, dependency-cruiser and stylelint.
Each takes the tool's own config type, less the keys the kit owns, and returns the whole config with a default for every kit rule.
A key only the repository knows has no default, so `tsc` refuses a config that leaves it out.
The builder throws when the tool loads such a config anyway.

| Builder | Required | The kit owns |
| --- | --- | --- |
| `@avi2dg/checks/oxlint` | `effect` | `extends`, `plugins`, `jsPlugins` and `categories` |
| `@avi2dg/checks/knip` | `entry`, where `[]` means the package scripts and tests name every entry | `include` |
| `@avi2dg/checks/dependency-cruiser` | nothing | `extends` |
| `@avi2dg/checks/stylelint` | `baseline` and `tokens`, where `false` leaves the design token rules off, with `bem`, `flatSelectors` and `noPageHas` turning on their families | `extends` and `plugins` |

A repository whose sources are Effect programs writes `oxlint.config.ts`:

```ts
import { defineConfig } from "@avi2dg/checks/oxlint";

export default defineConfig({
  effect: true,
  ignorePatterns: ["src/crawler-extract.js"],
});
```

`ignorePatterns`, `rules`, `overrides`, `settings`, `env`, `globals` and `options` mean what they mean in oxlint's own docs.
The kit's rules come first, and the repository's `rules` and `overrides` land after them.
An override that sets a `node/`, `promise/` or `unicorn/` rule gets the Effect override's `plugins`, since the kit loads those plugins only there.
[The Effect rules](effect-rules.md) lists what `effect` accepts.
`defineConfig` sets `options.typeAware`, so a plain `oxlint` runs the type-aware rules.
The module also exports the blocks the config is built from: `base`, `sizeBudget`, `effectRules`, `SOURCE_LIMITS`, `TEST_LIMITS`, `SOURCES` and `TESTS`.

`knip.config.ts` names the files nothing imports:

```ts
import { defineConfig } from "@avi2dg/checks/knip";

export default defineConfig({ entry: ["src/index.ts"] });
```

`dependency-cruiser.config.ts` is optional, since `checks-graphwalk` cruises against the kit's defaults without one:

```ts
import { defineConfig } from "@avi2dg/checks/dependency-cruiser";

export default defineConfig({ devOnly: ["^(?:evals|tests)/"] });
```

[The dependency rules](dependency-rules.md) lists its keys.

A repository whose `checks.config.ts` sets `frontendSyntax` writes `stylelint.config.ts`, which [checks-frontend-syntax](../gates/checks-frontend-syntax.md) loads and describes:

```ts
import { defineConfig } from "@avi2dg/checks/stylelint";

export default defineConfig({ baseline: "widely", tokens: false });
```

## The settings file

`checks.config.ts` holds the settings the kit reads that no tool file owns.
A repository creates `checks.config.ts` only when it declares a setting, and a missing file reads as no settings.
Publishing, repository visibility, runner labels, and CI jobs belong under `workflows`.
Local test selection, affected tests, agent policy, timeouts, timings, and exclusions belong under `test`.
Tracker prefixes belong under `commentGate`, and nested oxlint allowances belong under `lintCoverage`.
`copy` and `frontendSyntax` stay at the root.
Browser settings belong in [`checks.browser.config.ts`](../gates/checks-browser.md#what-it-reads).
Export the result of `defineConfig` from `@avi2dg/checks/config` as the default export of `checks.config.ts`.
Every section is optional.

```ts
import { defineConfig } from "@avi2dg/checks/config";

export default defineConfig({
  test: { extraLocalFiles: ["tests/e2e/checkout.test.ts"] },
  copy: { inputs: ["src/content/**/*.md"] },
});
```

<!-- generated settings-keys: bun run build writes it from src/core/settings.ts and scripts/doc-blocks.ts -->

| Key | Default | What it holds | Reader |
| --- | --- | --- | --- |
| `workflows.repositoryVisibility` | `"public"` | The GitHub repository visibility that selects generated workflow runners. | [checks-workflows](../gates/checks-workflows.md) |
| `workflows.releaseAssets` | `false` | Whether the generated main.yml, or the kit's release.yml, builds the files bun run release:assets writes on Linux and macOS and attaches them to each GitHub release. | [checks-workflows](../gates/checks-workflows.md#attach-release-assets) |
| `workflows.platformPackages` | None | The compiled binary the generated main.yml builds on each named platform and publishes as one npm package per platform before the main package, which lists them as optionalDependencies. | [checks-workflows](../gates/checks-workflows.md#publish-platform-packages) |
| `workflows.extraTestJobs` | `[]` | The test jobs the generated ci.yml runs beside its default ones, each with its own environment, setup commands and test command. | [checks-workflows](../gates/checks-workflows.md#add-a-test-job-with-its-own-setup) |
| `workflows.mutationRunsOn` | None | The runner labels for mutation jobs in a private repository. | [checks-ci-wiring](../gates/checks-ci-wiring.md) |
| `workflows.mutationShardCount` | `12` | The maximum number of shards in the generated mutation refresh, as an integer from 1 to 256. | [checks-mutation](../gates/checks-mutation.md#running-it-in-ci) |
| `workflows.selfHostedRunsOn` | None | The other sets of self-hosted runner labels that jobs in a private repository may use. | [checks-ci-wiring](../gates/checks-ci-wiring.md) |
| `workflows.testShards` | None | The number of parallel CI jobs for each test tier. | [checks-test](../gates/checks-test.md#parallel-runs) |
| `workflows.flakeCron` | None | The UTC cron expression for the generated flake workflow, limited to at most once a day with one minute and one hour. | [checks-workflows](../gates/checks-workflows.md#flake-schedule) |
| `workflows.setupNix` | `false` | Whether unit, e2e, release suite, flake, and whole-tree test jobs in code repositories run nix --version before tests. The jobs do not install Nix. | [checks-workflows](../gates/checks-workflows.md#set-up-nix) |
| `test.extraLocalFiles` | None | The extra test files to run with the local unit tier. | [checks-test](../gates/checks-test.md) |
| `test.affected` | None | The tests to run when a changed path is missing from the import graph. | [checks-test](../gates/checks-test.md#the-reach-map) |
| `test.allowAgentRunsOutsideCI` | `false` | Whether agents may start tests outside CI. This setting does not restrict people or CI. | [checks-local-tests](../gates/checks-local-tests.md) |
| `test.fileTimeoutSeconds` | `120` | The time limit in seconds for each test file in CI. | [checks-test](../gates/checks-test.md#test-file-time-limit) |
| `test.fileTimingsSeconds` | None | The recorded seconds per test file, which balance the shards. | [checks-test](../gates/checks-test.md#parallel-runs) |
| `test.excludeFiles` | `[]` | The repository-relative paths of test files to exclude from checks-test. | [checks-test](../gates/checks-test.md#test-file-exclusions) |
| `copy` | None | The input globs for the copy gate. | [checks-copy](../gates/checks-copy.md) |
| `frontendSyntax` | None | The input globs for the frontend syntax gate. | [checks-frontend-syntax](../gates/checks-frontend-syntax.md) |
| `commentGate.trackerKeyPrefixes` | `[]` | The uppercase tracker prefixes whose numbered keys the comment gate refuses. | [checks-comment-gate](../gates/checks-comment-gate.md#tracker-keys) |
| `lintCoverage.allowedNestedOxlintRules` | None | The rules each nested oxlint config, named by its repository-relative path, may turn off, down to a lower severity, or to other options than the root oxlint config sets. | [checks-lint-coverage](../gates/checks-lint-coverage.md#nested-oxlint-configs) |

<!-- end generated settings-keys -->

The TypeScript config type and the generated [JSON Schema](../../dist/checks.schema.json) both come from the grouped settings.
The type and the schema accept only the grouped keys.
The loader also reads deprecated flat keys in `checks.config.ts`, including browser keys, and prints deprecation notes on standard error.
Use the [configuration migration guide](../how-to/migrate-checks-configuration.md) to find the current key for each flat setting.
Each flat setting produces at most one note per process for its current config file.
`checks-test --pr`, `checks-test --changed`, and the CI `changes` job load the merge-base copy of `checks.config.ts` to compare affected-test maps.
That copy produces no deprecation notes.
Two definitions of one setting fail, even when their values match.
The kit loads a TypeScript file, not a JSON config.

A key the kit does not know fails the reading gate.
When a gate finds a setting in an unsupported file, it exits with code 2 and names where the setting belongs.
A `checks` object in `package.json` that sets `smoke`, `reach`, `mutationRunner` or `selfHostedRunners` fails the gate that reads that key with exit 2.
A root `browser-checks.json`, `copy.json` or `frontend-syntax.json` fails the gate that reads that key with exit 2.
`advisory-acks.json` stays a file of its own, since [checks-advisories](../gates/checks-advisories.md) reads it at a commit rather than from the working tree.

`tsconfig.json` keeps the config files in its program, so `bun run typecheck` holds them to the builders' types.

## Size limits

The size rules are oxlint's own rules at `error`, which every `oxlint.config.ts` built with `defineConfig` sets over the whole tree, so `bun run lint` fails on any file over them.
A repository records its existing violations with `oxlint --suppress-all`, which writes them to `oxlint-suppressions.json`.
`checks-suppressions-ratchet` refuses any count in that file that rises, and every count it still holds when the whole-tree run scans the whole tree.
`SOURCE_LIMITS` holds the limits for sources and `TEST_LIMITS` the limits for tests:

<!-- generated size-limits: bun run build writes it from SOURCE_LIMITS, TEST_LIMITS, SOURCES and TESTS in src/quality/presets/oxlint.ts and scripts/doc-blocks.ts -->

| Limits | oxlint rule | `**/*.ts`, `**/*.tsx`, `**/*.mts`, `**/*.cts` outside the tests | `tests/**`, `**/*.test.ts`, `**/*.test.tsx` |
| --- | --- | --- | --- |
| The most lines a file may hold, blank and comment lines counted | `max-lines` | 400 | 600 |
| The most lines a function may span, blank and comment lines counted | `max-lines-per-function` | 100 | off |
| The most statements a function may hold | `max-statements` | 30 | 50 |
| The highest cognitive complexity a function may reach, a switch counted once | `readability/cognitive-complexity` | 15 | 15 |
| The deepest a block may nest inside a function | `max-depth` | 4 | 4 |

<!-- end generated size-limits -->

A file a repository holds to another limit gets an ordinary override in `oxlint.config.ts`:

```ts
overrides: [{ files: ["src/lib/server.ts"], rules: { "max-lines": ["error", { max: 600 }] } }],
```

## Related topics

- [The Effect rules](effect-rules.md)
- [The dependency rules](dependency-rules.md)
- [checks-ci-wiring](../gates/checks-ci-wiring.md)
- [checks-suppressions-ratchet](../gates/checks-suppressions-ratchet.md)
- [checks-frontend-syntax](../gates/checks-frontend-syntax.md)
- [checks-docs](../gates/checks-docs.md)
