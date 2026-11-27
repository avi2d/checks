---
kind: reference
audience: consumers
---
# checks-mutation

`checks-mutation` runs Stryker and refuses a full run outside CI.

## What it checks

It refuses a full mutation run when `CI` is not `true`.
A full run is one with no `--mutate <glob>` and no `--incremental` flag.
A `--mutate` without a glob, `--incrementalFile` alone or `--incremental` with `--force` is still a full run.
Its refusal names `gh workflow run mutation` as the command that starts the same run in CI.
Outside CI, a person can run mutation testing on named files with `--mutate <glob>`, `--mutate=<glob>` or `-m <glob>`.
A person can run incrementally outside CI only with an existing report, because the run reuses the results of unchanged mutants.
That report is the `incrementalFile` Stryker resolves from the command line and the config file, else `reports/stryker-incremental.json`.
With no report there, the refusal says to pass `--mutate <glob>`, or to start the full baseline in CI with `gh workflow run mutation`.
The bin passes `--help`, `-h` and `--version` straight to Stryker for a person.
For an agent outside CI, the bin refuses every invocation unless `agentTests.allowLocal` is `true`, as [checks-local-tests](checks-local-tests.md) says.
A laptop with `CI=true` set opts in to a full run on purpose, and the refusal lets it through.

The shared Stryker preset makes the same decision from `process.argv` when a `stryker run` loads it.
So a bare `bunx stryker run` in a repository whose `stryker.conf.mjs` spreads the preset is refused the same way, and `checks-mutation` is a thin wrapper over that decision.
The preset also registers an ignore plugin that checks the incremental report once Stryker has resolved its options, because a config file can set `incrementalFile` after the preset loads.
A config that replaces `plugins` or `ignorers` must keep the preset's entries, or that check does not run.
The preset also exports `unitTestFiles`, which lists every `.test.ts` and `.test.tsx` file under `tests/unit` at config load.
The preset sets `bun.testFiles` to its result, so a covered, non-static mutant loads only the test files that cover it.
A repository without `tests/unit` lists no file, and the preset leaves `bun.testFiles` unset, so the runner finds every test itself.
A static mutant has no per-test coverage, so it still loads every listed file, and with bail it stops at the first test that fails.
The runner orders each mutant's test files by their dry-run duration and passes absolute paths to Bun.
For a static mutant, it puts likely killers first when bail is enabled.
For a `stryker run`, the preset resolves package-name preloads in `bunfig.toml` to absolute paths before the runner reads them.
It leaves relative and absolute preload paths unchanged.

The preset sets `ignoreStatic` only when `CHECKS_MUTATION_MODE` is `refresh`.
A baseline or a scoped run leaves the variable at another value or unset, so it still tests each static mutant.

The preset runs one Stryker worker per core when `RUNNER_ENVIRONMENT` is `github-hosted`, since a GitHub-hosted runner is a VM the job holds alone.
Elsewhere it runs one worker per two cores, rounded down and at least one, since a self-hosted runner or a laptop shares its cores.

Stryker's own deadlines end every run, and the preset sets them: `dryRunTimeoutMinutes` is 5, `timeoutMS` is 60000 and `timeoutFactor` is 1.5.
So the dry run of a healthy unit suite passes for up to 5 minutes, however many tests it holds.
A mutant run ends after 60 seconds plus 1.5 times the time its covering tests took in the dry run, plus the dry run's overhead.
The bun runner's `bun.timeout` kills a whole `bun test` process rather than one test.
So the preset sets it to 810000, past every deadline Stryker reaches with those values.
A test that never settles fails at Bun's own per-test limit, 5 seconds unless `bunfig.toml` sets `[test].timeout`.

The config then reads:

```js
import preset from "@avi2dg/checks/stryker.preset.js";

export default {
  ...preset,
};
```

## What it reads

It reads `AI_AGENT`, `CHECKS_AGENT`, `CI`, and `agentTests.allowLocal` to decide whether an agent can run tests outside CI.
When Stryker loads the preset, the preset reads `CHECKS_MUTATION_MODE` and `RUNNER_ENVIRONMENT` from the environment.
It forwards every argument to `stryker run` through `bun x stryker run`.

## Arguments

```sh
checks-mutation [--mutate <glob>] [--incremental] [<stryker args>...]
```

Every argument after the bin name forwards to `stryker run`.

## Exit codes

| Code | When |
| --- | --- |
| 0 | Stryker exited 0 |
| 1 | Stryker exited nonzero, including an incremental run refused for a missing report |
| 2 | a full run outside CI was refused, an agent run is refused outside CI when `agentTests.allowLocal` is `false`, an agent run outside CI whose `checks.config.ts` does not load, or Stryker could not start |

## Sample output

A full run outside CI prints its refusal and exits 2:

```
checks-mutation: refusing a full mutation run outside CI; start the same run in CI with `gh workflow run mutation`, or scope this run with `--mutate <glob>` or `--incremental`
```

A bare `bunx stryker run` fails to load its config with the same refusal as the error and exits 1.
An `--incremental` run with no report stops before instrumenting with the missing-report refusal as the error and exits 1.

## When it runs

A repository runs mutation through the `mutation` workflow that [checks-setup](checks-setup.md) writes.
A manual start with `gh workflow run mutation` starts the refresh.
No push to `main` starts a run.
Run scoped checks locally during development.

## Running it in CI

The `mutation.yml` [checks-setup](checks-setup.md) writes holds only the refresh, and [checks-ci-wiring](checks-ci-wiring.md#mutation-jobs) refuses every other mutation job.
A refresh restores the previous full report with `--full` for shard balancing, splits the tree into 4 shards and runs each shard with static mutants ignored.
It merges the shard reports, posts the score in its summary, and uploads the slimmed report as a fresh `mutation-baseline-full` artifact.
It starts by hand every 28 days.
[checks-mutation-scope](checks-mutation-scope.md) reads the full report to bring in the sources a changed unit test covers or kills.
The restore reads only a successful run of `mutation.yml` on `main`, so a sweep that fails publishes nothing a scope step reads.

The refresh jobs run on `ubuntu-latest`.
[checks-ci-wiring](checks-ci-wiring.md#runners) refuses a mutation job that names `CI_RUNS_ON` in `runs-on`.
The `name: mutation` line is what `gh workflow run mutation` looks up.
GitHub sets `CI=true` on every runner, so the preset lets the full run through there.

## Related topics

- [checks-mutation-compare](checks-mutation-compare.md)
- [checks-mutation-scope](checks-mutation-scope.md)
- [checks-subsumed-tests](checks-subsumed-tests.md)
