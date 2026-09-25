# checks-lint

`checks-lint` is the entry point that runs every lint gate of the kit over one range, and a reader looks it up to learn which range it resolves and how a repository selects its gates.

## What it checks

It runs each gate the table under [What runs](../../README.md#what-runs) lists, in that table's order, and names every one that fails rather than stopping at the first.
Each gate runs as its own bin in a child process, with its output passed straight through, so a gate behaves the same called alone or through `checks-lint`.
`checks-ci-wiring` always runs, so a repository on `checks-lint` declares `gates.ci`, as [checks-ci-wiring](checks-ci-wiring.md) says.
It holds the test layout unless the selection leaves out `checks-test-layout`.

## What it reads

It reads `quality.json` for `defaultBranch` and `gates.lint`, and resolves the range once, handing the same one to every range gate.
A tree gate reads the working tree and is handed no range.

Locally, and on any event other than a pull request, the range ends at `HEAD` and starts where `HEAD` branched from the origin default branch.
That branch is `origin/HEAD`.
When `origin/HEAD` is not set, as in an `actions/checkout` clone, it is `origin/<defaultBranch>` from `quality.json`, and `origin/main` when that is not declared.

In a GitHub Actions pull request, where `GITHUB_EVENT_NAME` is `pull_request`, the range ends at the event's head sha and starts where that branched from `origin/<base branch>`, so GitHub's merge commit is never in it.
The base branch is read from the fetch, not from the event's recorded base sha, which GitHub leaves stale once the base branch advances after the pull request opens.

The range always starts at the merge base, never at the base branch's tip, since commits the base branch gained after the head branched off would otherwise count against the head.
When the head is the merge base, as on a push to the default branch or a local run on it, the range would be empty.
Each range gate is then handed that tip commit alone, and checks it against its parent, or against the empty tree when it is a repository's first commit:

```
checks-lint: tip 10ba7d8935b73ed72624120a1542e51bd21ca7c7 from HEAD against origin/main
```

A clone with no remote-tracking refs at all has no default branch to start from, such as a freshly initialised repository with no remote or one whose remote was never fetched.
Each range gate is then handed `HEAD` alone the same way:

```
checks-lint: tip 10ba7d8935b73ed72624120a1542e51bd21ca7c7 from HEAD alone, as the clone has no remote-tracking refs
```

Once any ref sits under `refs/remotes/`, a missing `origin/<default branch>` exits 2 instead.
That is the shape of a shallow CI checkout, where `HEAD` alone would leave the commits before it unchecked.

## Arguments

```sh
checks-lint
checks-lint <base-ref> <head-ref>
```

With no arguments it resolves the range as What it reads says.
A base and a head override that resolution.

## Exit codes

| Code | When |
| --- | --- |
| 0 | every gate passed |
| 1 | a gate found a violation |
| 2 | the range or the selection does not resolve, or no failing gate could decide |

## Sample output

It prints the range, the declared selection if there is one, each gate's own report, then its verdict:

```
checks-lint: range 2504acf098d120e73a8ece3c96f22b934f35c6a8..10ba7d8935b73ed72624120a1542e51bd21ca7c7 from HEAD against origin/main
...
checks-lint: 3 of 10 gate(s) failed: checks-commit-identity, checks-comment-gate, checks-suppressions-ratchet
```

## Opting out

A repository leaves out a gate that does not apply to it, as Gate selection says.
A repository that runs its gates without `checks-lint` calls each gate's bin in its own CI step and declares each command in `gates.ci`.

## Gate selection

A repository with no TypeScript source gives `checks-lint-coverage`, `checks-test-layout`, `checks-size-budget` and `checks-feature-owners` nothing to check, and test-layout would still refuse its missing `bun test` script and `bunfig.toml`.
It declares the gates `checks-lint` runs as `gates.lint`:

```json
"gates": {
  "ci": ["bun run lint"],
  "lint": [
    "checks-commit-identity",
    "checks-comment-gate",
    "checks-suppressions-ratchet",
    "checks-ci-wiring",
    "checks-docs",
    "checks-quality"
  ]
}
```

`checks-lint` runs exactly those, in the order of the table under What runs, and every gate when `gates.lint` is absent.
A selection in `quality.json` always keeps `checks-quality`, since the file it sits in is what makes that gate apply.
A step running `checks-lint` then counts only for a declared gate that `gates.lint` keeps.

A selection may leave out only a gate that does not apply, and the Runs in column of the table under What runs says where each gate applies.
Both `checks-lint` and `checks-ci-wiring` exit 2 on a `gates.lint` that names an unknown gate or leaves out one that applies to every repository.
`checks-ci-wiring` exits 1 when the selection leaves out a gate the repository's tracked files make applicable, and names the gate and the files:

```
ci-wiring: quality.json gates.lint leaves out 4 gate(s) this repository's contents make applicable:
  checks-lint-coverage: the repository tracks TypeScript source (src/widget.ts)
  checks-test-layout: the repository tracks TypeScript source (src/widget.ts)
  checks-size-budget: the repository tracks TypeScript source (src/widget.ts)
  checks-feature-owners: the repository tracks TypeScript source (src/widget.ts)
```

It reads the files tracked at the checkout, so the pull request that adds the first TypeScript file is the one refused.

## Running it in CI

CI runs it through `lint`.
The checkout fetches the whole history, which the merge base needs:

```yaml
on:
  pull_request:
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun run lint
```

## Related topics

- [What runs](../../README.md#what-runs)
- [checks-ci-wiring](checks-ci-wiring.md)
- [The quality file](../configs/quality-file.md)
