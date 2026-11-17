---
kind: reference
audience: consumers
---
# checks-local-tests

`checks-local-tests` reports whether the current repository allows local tests for agents.

## What it checks

The `localTests` key in `checks.config.ts` is `"blocked"` by default.
Set it to `"allowed"` to allow agents to run tests locally:

```ts
import { defineConfig } from "@avi2dg/checks/config";

export default defineConfig({ localTests: "allowed" });
```

The bin prints exactly `blocked\n` or `allowed\n` to standard output.
An invalid or unreadable config is reported on standard error.

## What it reads

It reads the `localTests` key of `checks.config.ts` in the current repository.
A missing file or a missing key means `blocked`.
It reads no environment marker and no CI value.

## Arguments

```sh
checks-local-tests
```

It takes no arguments.

## Exit codes

| Code | Result |
| --- | --- |
| 0 | The bin printed `blocked` or `allowed`. |
| 2 | An argument was passed, or `checks.config.ts` does not load or holds an invalid `localTests` value. |

## Sample output

```
blocked
```

## When it runs

A person runs it by hand to read the switch before starting a local test run.

## Agent marker

The kit exports the marker name as `AGENT_MARKER` from `@avi2dg/checks/local-tests`.
Set `CHECKS_AGENT=1` when starting an agent.
When that marker is set, `CI` is not true, and `localTests` is blocked, `checks-test`, `checks-browser`, `checks-flake`, `checks-mutation`, and the Bun test preload refuse to start.
The refusal names `localTests`.
Without the marker or with `CI=true`, the guard allows the run.
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
