---
kind: reference
audience: consumers
---
# checks-local-tests

`checks-local-tests` reports whether the current repository allows local tests for agents.

## Setting

The `localTests` key in `checks.config.ts` is `"blocked"` by default.
Set it to `"allowed"` to allow agents to run tests locally:

```ts
import { defineConfig } from "@avi2dg/checks/config";

export default defineConfig({ localTests: "allowed" });
```

`checks-local-tests` prints exactly `blocked\n` or `allowed\n` to standard output and exits 0.
It reports an invalid or unreadable config on standard error and exits 2.
It takes no arguments.
The answer is independent of the environment marker and CI.

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
The guard covers only callers that invoke it.

## Related topics

- [Native settings](../configs/native-settings.md)
- [checks-test](checks-test.md)
- [checks-browser](checks-browser.md)
- [checks-test-layout](checks-test-layout.md)
