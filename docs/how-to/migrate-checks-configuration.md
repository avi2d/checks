---
kind: how-to
audience: consumers
---
# Migrate checks configuration

Move flat settings into sections of `checks.config.ts` and put the browser plan in its own file.
The move does not change which checks run.

## Before you begin

- Install a kit release that exports `@avi2dg/checks/browser-config`.
- If you have no checks settings, leave both files out.

## Move the settings

To keep the same checks with the current config files:

1. Keep using `defineConfig` from `@avi2dg/checks/config`.
   Move each flat setting you use to the path in the table.
   Keep the values and native tool files as they are.
1. If you have a browser plan, move the object under `browser` into `checks.browser.config.ts`.
   Export it as the default using `defineBrowserConfig` from `@avi2dg/checks/browser-config`.
   Put any browser options in the same object, using the keys in the table.
   See the [browser plan example](../gates/checks-browser.md#what-it-reads).
1. Delete `checks.config.ts` if it has no settings left.
1. Run your TypeScript check.
   If you use generated workflows, run `bunx checks-workflows` and confirm they still match.

The kit reads flat settings at runtime and prints a deprecation note on standard error.
Do not set the same key in both locations, even when the values match.
The reader names both locations and stops.
The browser builder and schema require the full plan, so move the plan with any options when you use either of them.
See [what the browser runner reads](../gates/checks-browser.md#what-it-reads) if you need to move the options first at runtime.

<!-- generated config-migration-keys: bun run build writes it from src/core/settings.ts, src/core/browser-settings.ts, scripts/browser-doc-rows.ts and scripts/doc-blocks.ts -->

| Flat key in `checks.config.ts` | Where it goes |
| --- | --- |
| `repositoryVisibility` | `workflows.repositoryVisibility` |
| `releaseAssets` | `workflows.releaseAssets` |
| `platformPackages` | `workflows.platformPackages` |
| `extraTestJobs` | `workflows.extraTestJobs` |
| `mutationRunner` | `workflows.mutationRunsOn` |
| `mutationShardCount` | `workflows.mutationShardCount` |
| `selfHostedRunners` | `workflows.selfHostedRunsOn` |
| `testTierShards` | `workflows.testShards` |
| `flakeCron` | `workflows.flakeCron` |
| `smoke` | `test.extraLocalFiles` |
| `reach` | `test.affected` |
| `agentTests.allowLocal` | `test.allowAgentRunsOutsideCI` |
| `testFileMaxSeconds` | `test.fileTimeoutSeconds` |
| `testFileTimings` | `test.fileTimingsSeconds` |
| `testFileSkips` | `test.excludeFiles` |
| `trackerKeyPrefixes` | `commentGate.trackerKeyPrefixes` |
| `nestedOxlintConfigs` | `lintCoverage.allowedNestedOxlintRules` |
| `browser` | The default export of `checks.browser.config.ts` |
| `browserRoutes` | `affectedRoutes` in `checks.browser.config.ts` |
| `browserBuild` | `buildCommand` in `checks.browser.config.ts` |
| `browserTimings` | `timingsMs` in `checks.browser.config.ts` |

<!-- end generated config-migration-keys -->

Keep `copy` and `frontendSyntax` where they are.
The [shared JSON Schema](../../dist/checks.schema.json) describes the grouped format only.
Use the [browser JSON Schema](../../dist/checks.browser.schema.json) to validate a browser plan as data.

## Related topics

- [Native settings](../configs/native-settings.md)
- [checks-browser](../gates/checks-browser.md)
