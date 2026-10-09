---
kind: reference
audience: consumers
---
# Native settings

A consuming repository puts each setting in the file its tool reads, and no manifest of the kit gathers them.

## Settings by file

| File | Setting | Reader |
| --- | --- | --- |
| `.github/workflows/*.yml` | Pull request commands, scheduled commands, runner labels | GitHub Actions and `checks-ci-wiring` |
| `oxlint.config.ts` | Effect paths and their exemptions, ignore patterns, and any rule or budget the repository sets over the kit's defaults | oxlint and `checks-effect-scope` |
| `oxlint-suppressions.json` | The existing violations oxlint suppresses, per file and rule | oxlint and `checks-suppressions-ratchet` |
| `exports-baseline.json` | The existing unused exports and types, per file, kind and name | `checks-exports` |
| `.jscpd.json` | The `path` and `ignore` globs of the files repetition is measured in | jscpd and `checks-repetition` |
| `knip.config.ts` | The `entry` globs Knip traces unreferenced files from | Knip, `checks-unused` and `checks-exports` |
| `dependency-cruiser.config.ts` | Entry points nothing imports, paths that may import dev dependencies, and import boundaries, when the kit's defaults do not fit | `checks-imports` |
| `tsconfig.json` | Compiler options, and the Effect language service plugin whose `overrides` and kit severities `checks-effect-scope` writes, keeping every other key | TypeScript and Effect language service |
| `package.json` | `scripts` with the `checks-vendor` arguments in `prepare`, `author` and `contributors` | Bun, `checks-commit-identity` and `checks-vendor` |
| `bunfig.toml` | Test discovery and quarantine exclusion | Bun and `checks-test-layout` |
| `stryker.conf.mjs` | Mutation settings | Stryker |
| Each page under `docs/` | Diátaxis mode in `kind` front matter, and `audience: consumers` on a page that speaks to a consuming repository | `checks-docs` |

Every page under `docs/` names its mode in `kind` front matter, whatever directory holds it.
A page whose front matter sets `audience: consumers` names commands that a consuming repository runs.
`checks-docs` skips the `bun run` commands on such a page, and resolves those in every other living doc or agent file as [Paths, links and commands](../gates/checks-docs.md#paths-links-and-commands) says.

## The config builders

The kit ships a `defineConfig` for oxlint, Knip and dependency-cruiser.
Each takes the tool's own config type, less the keys the kit owns, and returns the whole config with a default for every kit rule.
A key only the repository knows has no default, so `tsc` refuses a config that leaves it out.
The builder throws when the tool loads such a config anyway.

| Builder | Required | The kit owns |
| --- | --- | --- |
| `@avi2dg/checks/oxlint` | `effect` | `extends`, `plugins`, `jsPlugins` and `categories` |
| `@avi2dg/checks/knip` | `entry`, where `[]` means the package scripts and tests name every entry | `include` |
| `@avi2dg/checks/dependency-cruiser` | nothing | `extends` |

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

`dependency-cruiser.config.ts` is optional, since `checks-imports` cruises against the kit's defaults without one:

```ts
import { defineConfig } from "@avi2dg/checks/dependency-cruiser";

export default defineConfig({ devOnly: ["^(?:evals|tests)/"] });
```

[The dependency rules](dependency-rules.md) lists its keys.
`tsconfig.json` keeps the three config files in its program, so `bun run typecheck` holds them to the builders' types.

## Size limits

The size rules are oxlint's own rules at `error`, which every `oxlint.config.ts` built with `defineConfig` sets over the whole tree, so `bun run lint` fails on any file over them.
A repository records its existing violations with `oxlint --suppress-all`, which writes them to `oxlint-suppressions.json`.
`checks-suppressions-ratchet` refuses any count in that file that rises.
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
- [checks-docs](../gates/checks-docs.md)
