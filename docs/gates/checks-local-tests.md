---
kind: reference
audience: consumers
---
# checks-local-tests

`checks-local-tests` reports whether the current repository allows local tests for agents.

## What it checks

The `test.allowAgentRunsOutsideCI` setting in `checks.config.ts` defaults to `false`.
Set it to `true` to let agents run tests outside CI:

```ts
import { defineConfig } from "@avi2dg/checks/config";

export default defineConfig({ test: { allowAgentRunsOutsideCI: true } });
```

The bin prints exactly `blocked\n` or `allowed\n` to standard output.
An invalid or unreadable config is reported on standard error.
A flat `agentTests.allowLocal` value is still read, with a deprecation note on standard error.

## What it reads

It reads `test.allowAgentRunsOutsideCI` from `checks.config.ts` in the current repository.
If the file, the `test` section or its `allowAgentRunsOutsideCI` key is missing, it prints `blocked`.
It does not read the environment.
If the config sets `localTests`, the bin exits 2 and names `test.allowAgentRunsOutsideCI` as the replacement.

## Arguments

```sh
checks-local-tests
```

It takes no arguments.

## Exit codes

| Code | Result |
| --- | --- |
| 0 | The bin printed `blocked` or `allowed`. |
| 2 | An argument was passed, or `checks.config.ts` does not load or has an invalid setting. |

## Sample output

```
blocked
```

## When it runs

A person runs it by hand to read the switch before starting a local test run.

## Agent marker

The kit treats a process as an agent if `AI_AGENT` is non-empty or `CHECKS_AGENT=1`.
If an agent runs outside CI and `test.allowAgentRunsOutsideCI` is `false`, `checks-test`, `checks-browser`, `checks-flake`, `checks-mutation`, and the Bun test preload refuse to start.
The refusal names `test.allowAgentRunsOutsideCI`.
The guard does not block people or runs with `CI=true`.
The kit exports `AGENT_MARKER` for `CHECKS_AGENT`, `AI_AGENT_MARKER` for `AI_AGENT` and `isAgent` from `@avi2dg/checks/local-tests`.
The guard does not restrict build, lint, or typecheck commands.

The preload is in the `[test]` table of the shipped `bunfig.toml`.
`checks-setup` copies that file into a new repository, and `checks-test-layout` checks its test settings.
The preload runs only when Bun starts in the directory that holds `bunfig.toml`.
The guard does not cover a `bun test` run started outside the directory that holds `bunfig.toml` or a test runner other than the kit bins.

## Related topics

- [Native settings](../configs/native-settings.md)
- [checks-test](checks-test.md)
- [checks-browser](checks-browser.md)
- [checks-test-layout](checks-test-layout.md)
