# checks

`@avi2dg/checks` is the kit of deterministic checks a TypeScript repository installs to hold its code, tests, commits, CI wiring and docs to one shared standard.
It ships the lint gates `checks-lint` runs over each pull request, the test runners, and the configs a repository extends for oxlint, tsc, dependency-cruiser, commitlint, bun and Stryker.
Each repository owns its workflows and native tool configs, as [Native settings](docs/configs/native-settings.md) maps.

## Before you begin

<!-- generated prerequisites: bun run build writes it from package.json, .bun-version and scripts/doc-blocks.ts -->

- A git repository, whose history the range gates read.
- Bun 1.3.13, which runs every bin.
- The peer dependencies, at the exact versions the kit pins:
  - `@effect/tsgo` 0.45.0
  - `@swc/core` 1.16.2
  - `dependency-cruiser` 18.4.0
  - `effect` 4.0.0-rc.115
  - `jscpd` 5.3.2
  - `oxlint` 1.83.0
  - `oxlint-tsgolint` 7.0.2002
  - `typescript` 7.0.2

<!-- end generated prerequisites -->

## Install

To consume the kit from a repository:

1. Add the kit and its peers:

   <!-- generated install: bun run build writes it from package.json and scripts/doc-blocks.ts -->

   ```sh
   bun add -d @avi2dg/checks @effect/tsgo@0.45.0 @swc/core@1.16.2 dependency-cruiser@18.4.0 effect@4.0.0-rc.115 jscpd@5.3.2 oxlint@1.83.0 oxlint-tsgolint@7.0.2002 typescript@7.0.2
   ```

   <!-- end generated install -->

1. Extend the oxlint base in `.oxlintrc.json`, restating `plugins`:

   ```json
   {
     "extends": ["./node_modules/@avi2dg/checks/oxlintrc.json"],
     "plugins": ["typescript", "oxc", "eslint", "import"]
   }
   ```

1. Keep oxlint out of `node_modules/` through `.gitignore`:

   ```
   node_modules/
   ```

1. Extend the tsconfig fragment in `tsconfig.json`:

   ```json
   {
     "extends": "@avi2dg/checks/tsconfig.effect.json"
   }
   ```

1. Copy the bunfig preset:

   ```sh
   cp node_modules/@avi2dg/checks/bunfig.toml bunfig.toml
   ```

1. Name the repository's entry files in `knip.config.ts`, spreading the kit's Knip base:

   ```ts
   import base from "@avi2dg/checks/knip-base.json";

   export default { ...base, entry: ["src/index.ts", "tests/**/*.test.ts"] };
   ```

1. Add scripts to `package.json`, replacing the build entry with the repository's own build command:

   ```json
   "build": "bun build src/index.ts --outdir dist --target node",
   "lint": "oxlint --type-aware && checks-lint",
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
         - run: bun install --frozen-lockfile
         - run: bun run build
         - run: git diff --exit-code
         - run: bun run lint
         - run: bun run typecheck
         - run: bun run test
   ```

Add a pull request title lint step in another workflow using `./node_modules/.bin/commitlint`.
`bun run lint` then ends with `checks-lint: <count> gate(s) pass`.

## What runs

`checks-lint` runs each of these gates that applies to the repository, and names every one that fails.
A gate reads either the working tree or the range `checks-lint` resolves.
The table groups the gates by vector, the part of a repository each one judges.

<!-- generated gates: bun run build writes it from KIT_GATES in src/core/gates.ts and scripts/doc-blocks.ts -->

| Vector | Gate | Reads | Runs in |
| --- | --- | --- | --- |
| complexity | [`checks-suppressions-ratchet`](docs/gates/checks-suppressions-ratchet.md) | the range | every repository |
| complexity | [`checks-repetition`](docs/gates/checks-repetition.md) | the range | a repository tracking `*.ts` or `*.tsx` |
| complexity | [`checks-unused`](docs/gates/checks-unused.md) | the working tree | a repository tracking `*.ts` or `*.tsx` |
| complexity | [`checks-exports`](docs/gates/checks-exports.md) | the range | a repository tracking `*.ts` or `*.tsx` |
| quality | [`checks-lint-coverage`](docs/gates/checks-lint-coverage.md) | the working tree | a repository tracking `*.ts` or `*.tsx` |
| quality | [`checks-comment-gate`](docs/gates/checks-comment-gate.md) | the range | every repository |
| testing | [`checks-test-layout`](docs/gates/checks-test-layout.md) | the working tree | a repository tracking `*.ts` or `*.tsx` |
| testing | [`checks-quarantine-clock`](docs/gates/checks-quarantine-clock.md) | the range | every repository |
| docs | [`checks-docs`](docs/gates/checks-docs.md) | the range, and every agent file at the head commit | every repository |
| delivery | [`checks-commit-identity`](docs/gates/checks-commit-identity.md) | the range | every repository |
| delivery | [`checks-ci-wiring`](docs/gates/checks-ci-wiring.md) | the working tree | every repository |
| dependencies | [`checks-advisories`](docs/gates/checks-advisories.md) | the range | a repository tracking `bun.lock` |

<!-- end generated gates -->

These bins run on their own:

- [`checks-test`](docs/gates/checks-test.md) runs the suite as `scripts.test` and refuses a skip without a reason at its test site.
- [`checks-flake`](docs/gates/checks-flake.md) runs the suite on a schedule and records the seeds a flaky test fails with.
- [`checks-mutation`](docs/gates/checks-mutation.md) runs Stryker for scoped checks and refuses a full run outside CI.
- [`checks-mutation-compare`](docs/gates/checks-mutation-compare.md) holds every mutant in a pull request to no regression.
- [`checks-subsumed-tests`](docs/gates/checks-subsumed-tests.md) lists each test another test subsumes in a mutation run.
- [`checks-changelog`](docs/gates/checks-changelog.md) writes the pending release into `CHANGELOG.md` from the conventional commits since the last release.
- [`checks-release-notes`](docs/gates/checks-release-notes.md) writes one `CHANGELOG.md` section to a file for a GitHub release.
- [`checks-release-report`](docs/gates/checks-release-report.md) tells whether the history holds unreleased features or fixes since the last tag.
- [`checks-vendor`](docs/gates/checks-vendor.md) pins each library its `prepare` arguments name to a shared read-only clone and links it under `repos/`.

`checks-lint` has [its own page](docs/gates/checks-lint.md), which says which range it resolves.
The oxlint base, the dependency-cruiser base and the commitlint config run through their own tools, as the pages under Related topics say.

## Upgrade

To move a repository to a newer release of the kit:

1. Run the install line again, which moves the kit to its newest release and the peers to the versions it pins.
1. Review the Effect overrides in `.oxlintrc.json` and `tsconfig.json` when a release changes their presets.
1. Copy `node_modules/@avi2dg/checks/bunfig.toml` over `bunfig.toml` again, since `checks-test-layout` compares the copy with the installed preset.
1. Run `bun run lint`, `bun run typecheck` and `bun run test`.

The repository's lockfile pins the kit, so a repository moves only when it runs these steps.
[CHANGELOG.md](CHANGELOG.md), shipped in the package, lists what each release changed.

## Where things are

Every path is relative to the installed package, `node_modules/@avi2dg/checks/`.

<!-- generated shipped: bun run build writes it from package.json and scripts/doc-blocks.ts -->

| Path | What it holds |
| --- | --- |
| `CHANGELOG.md` | every release, and what it changed |
| `docs/` | a reference page per bin and per shared config, and why the kit is shaped this way |
| `bunfig.toml` | the bunfig preset a repository copies |
| `commitlint.config.js` | the shared commitlint config |
| `dependency-cruiser.config.js` | the shared dependency-cruiser base |
| `knip-base.json` | the Knip base a repository's configuration imports |
| `src/` | every bin, which a package script calls by its `checks-` name, the modules the bins import, and the Effect rule blocks under `src/quality/presets/` |
| `dist/` | the compiled oxlint plugins and the doc templates, one template per kind of doc file |
| `oxlintrc.json` | the oxlint base config `.oxlintrc.json` extends |
| `stryker.preset.js` | the Stryker mutation-testing preset, which refuses a full run outside CI |
| `tsconfig.effect.json` | the tsconfig fragment with the shared compiler options and the Effect language-service block |
| `ts-reset.d.ts` | the two ts-reset rules `tsconfig.effect.json` lists in `files` |

<!-- end generated shipped -->

## Related topics

- [Native settings](docs/configs/native-settings.md)
- [The Effect rules](docs/configs/effect-rules.md)
- [The TypeScript rules](docs/configs/typescript-rules.md)
- [The dependency rules](docs/configs/dependency-rules.md)
- [The commit message lint](docs/configs/commit-messages.md)
- [Why it is shaped this way](docs/design.md)
