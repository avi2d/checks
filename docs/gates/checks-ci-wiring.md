# checks-ci-wiring

`checks-ci-wiring` is the gate that fails when a command the repository's CI must run no longer runs on pull requests to the default branch, and a reader looks it up to learn which workflow step counts.

## What it checks

No local check sees a gate drop out of CI, since a workflow whose lint step became a no-op leaves `bun run lint` green.
The repository declares its gates once, in `quality.json`:

```json
"gates": {
  "ci": ["bun run lint", "bun run typecheck", "bun run test"]
}
```

It looks, for each gate, for a `run:` step that is the gate command alone on one line, optionally followed by plain arguments.
Plain arguments are words, quoted strings, and `$VAR` or `${VAR}` expansions.
`bun run lint --quiet` and `bunx checks-comment-gate "origin/$BASE_REF" "$HEAD_SHA"` count.
`bun run lint:deps`, `echo bun run lint` and a step `name:` do not.

A step never counts when its script has a second line or any of these, because each can run the gate without its failure failing the step:

- `|`, `||`, `&&`, `;` or `&`
- `$(...)` or backticks
- `<` or `>` redirection
- a comment
- a leading `NAME=value`

The report names such a gate and says to give it its own step with nothing else in it.
A gate step counts only when all of these hold:

- Its workflow triggers on `pull_request`.
  Any `branches` or `branches-ignore` filter there keeps the default branch, any `types` filter keeps `opened` and `synchronize`, and it sets no `paths` or `paths-ignore` filter, which would let some pull requests skip the gate.
- Neither the step nor its job sets `if: false` or `continue-on-error: true`, bare or as `${{ false }}` and `${{ true }}`.
- Its job needs no job, directly or through a chain, that sets `if: false`, unless a job on that chain has an `if:` calling `always()`, `failure()` or `cancelled()`.
  GitHub prefixes every other `if:`, including `true` and `success()`, with `success()`, so a job whose needed job was skipped is skipped too.

A job calling a local reusable workflow, such as `uses: ./.github/workflows/x.yml`, passes its own trigger and `if:` down to the called workflow's steps.
A remote reusable workflow, such as `uses: owner/repo/...@ref`, is not a supported way to wire a gate.
It is not read, so a gate must run as a `run:` step in the repository's own workflows, such as `bunx checks-comment-gate`.

A step running `checks-lint` also counts for a declared gate that calls one of the gates `checks-lint` runs by its bare bin name, when the step calls `checks-lint` the same way.
`bunx checks-lint` counts for `bunx checks-comment-gate "origin/$BASE_REF" "$HEAD_SHA"`.
A step running `bun run lint` counts only for the `bun run lint` gate, since the check never reads what a package script runs.
So once `lint` runs `checks-lint`, the per-gate entries can leave `gates.ci` along with the workflows that ran them.

A command a schedule must run, such as the flake run, goes in `gates.scheduled`:

```json
"gates": {
  "ci": ["bun run lint", "bun run typecheck", "bun run test"],
  "scheduled": ["bunx checks-flake --runs 10 --report flake-report.json"]
}
```

Each counts only as a step of the same plain shape in a workflow whose `on` carries `schedule` with at least one `cron`, under the same `if: false`, `continue-on-error: true` and `needs` rules as a gate.

It also checks `gates.lint`, as [Gate selection](checks-lint.md#gate-selection) says.

## What it reads

It reads the working tree: `quality.json` for `defaultBranch`, `gates.ci`, `gates.scheduled` and `gates.lint`, and every `.github/workflows/*.yml` and `*.yaml`.
The default branch is `main` when `quality.json` declares none.
It parses each workflow with `Bun.YAML` and never runs it.

## Arguments

It takes none.

## Exit codes

| Code | When |
| --- | --- |
| 0 | every declared command runs where it must |
| 1 | a gate does not run on pull requests to the default branch, a scheduled command runs on no schedule, or `gates.lint` leaves out a gate that applies |
| 2 | `quality.json` declares no `gates.ci` or does not decode, a gate or scheduled command is not one plain command, or a workflow does not parse |

Whether a workflow is well formed is actionlint's question, not this one's.

## Sample output

It names each gap, with every step that runs the gate and why that step does not count:

```
ci-wiring: 1 of 8 gate(s) do not run on pull requests to main:
  bun run lint
    .github/workflows/release.yml job publish step 7: .github/workflows/release.yml does not trigger on pull_request
```

It names each scheduled command no schedule runs:

```
ci-wiring: 1 of 1 scheduled command(s) do not run on a schedule:
  bunx checks-flake --runs 10 --report flake-report.json
    .github/workflows/ci.yml job checks step 5: .github/workflows/ci.yml does not trigger on a schedule
```

## Opting out

It applies to every repository, so no selection leaves it out.
It runs inside `lint`, through `checks-lint`, because deleting the step that runs a check is the violation it catches:

```json
"scripts": {
  "lint": "oxlint --type-aware && checks-lint"
}
```

## Limits

The check reads workflow files and never runs them, so it deliberately does not evaluate these:

- an `if:` expression other than a constant `true` or `false`, which counts as running
- a `strategy.matrix` `include` or `exclude`, so a matrix that drops every combination still counts as running its steps
- a remote reusable workflow, whose steps are never read
- anything that happens at run time on the runner, such as what the gate command itself does, the shell's options, and a step or job that fails or times out before the gate step

## Related topics

- [checks-lint](checks-lint.md)
- [checks-flake](checks-flake.md)
- [The quality file](../configs/quality-file.md)
