# The quality file

`quality.json` at the repository root says what the repository has opted into, and a reader looks it up to learn what each key holds and which bin reads it.

## Keys

The kit's bins find the file at the git root and read it there:

```json
{
  "$schema": "./node_modules/@avi2dg/checks/quality.schema.json",
  "defaultBranch": "main",
  "gates": {
    "ci": ["bun run lint", "bun run typecheck", "bun run test"],
    "scheduled": ["bunx checks-flake --runs 10 --report flake-report.json"]
  },
  "runsOn": ["self-hosted", "Linux", "X64", "winbox"],
  "commitIdentity": { "authors": [{ "name": "avi2d", "email": "avi2dg@gmail.com" }] },
  "sources": {
    "production": ["src/**/*.ts"],
    "effect": { "paths": ["src/**/*.ts"], "exempt": ["src/host/*.ts"] }
  },
  "size": { "applies": "ratchet", "tests": { "fileLines": 800 } },
  "features": [
    {
      "name": "billing",
      "root": "src/billing",
      "entries": ["src/billing/index.ts"],
      "allowFrom": ["src/main.ts"],
      "proof": "tests/e2e/billing.test.ts"
    }
  ],
  "changeSignal": "advisory",
  "agentRules": { "on": [], "off": [] },
  "docs": { "pages": { "reference": ["docs/gates/*.md"], "explanation": ["docs/design.md"] } }
}
```

<!-- generated quality-keys: bun run build writes it from Quality in scripts/quality-file.ts and scripts/doc-blocks.ts -->

| Key | Read by | Holds |
| --- | --- | --- |
| `defaultBranch` | `checks-lint`, `checks-ci-wiring`, `checks-quality` | the branch pull requests merge into, `main` when absent |
| `gates.ci` | `checks-ci-wiring`, `checks-quality` | the commands CI runs on every pull request, as [checks-ci-wiring](../gates/checks-ci-wiring.md) says |
| `gates.scheduled` | `checks-ci-wiring` | the commands a schedule runs |
| `gates.lint` | `checks-lint`, `checks-ci-wiring` | the gates `checks-lint` runs when not all apply, as [Gate selection](../gates/checks-lint.md#gate-selection) says |
| `runsOn` | `checks-quality` | the runner labels every job the ci and commitlint workflows run on, `ubuntu-latest` when absent |
| `commitIdentity.authors` | `checks-commit-identity` | the identities allowed to author and commit, as [checks-commit-identity](../gates/checks-commit-identity.md) says |
| `sources.production` | `checks-size-budget`, `checks-repetition`, `checks-quality` | the source the repository ships, as [checks-size-budget](../gates/checks-size-budget.md) and [checks-repetition](../gates/checks-repetition.md) say |
| `sources.effect` | `checks-quality` | the paths held to the Effect rules, and the files under them that are not, as [The Effect rules](effect-rules.md) says |
| `sources.libraries` | `checks-vendor`, `checks-test-layout` | the libraries pinned to a shared read-only clone, as [checks-vendor](../gates/checks-vendor.md) says |
| `size` | `checks-size-budget` | the size budget of production and test files, and how a change is held to it, as [checks-size-budget](../gates/checks-size-budget.md) says |
| `features` | `featureRules`, `checks-feature-owners` | each feature's root, entries, exempt importers and proof, as [checks-feature-owners](../gates/checks-feature-owners.md) says |
| `changeSignal` | `checks-feature-owners` | `advisory` to list the feature owners a change touches |
| `agentRules.on` | agent Rule selection, not the kit | catalogued Rules switched on for this repository |
| `agentRules.off` | agent Rule selection, not the kit | catalogued Rules switched off for this repository |
| `docs.pages` | `checks-docs` | the Diátaxis mode of each page, by glob, as [checks-docs](../gates/checks-docs.md) says |
| `docs.forConsumers` | `checks-docs` | the living docs that speak to a repository installing this one, by glob, whose `bun run` commands name that repository's scripts |

<!-- end generated quality-keys -->

Every key is optional.

## Schema

The bins decode the file with one Effect `Schema`, and the package ships `quality.schema.json` emitted from that schema.
The `$schema` line therefore gives an editor the verdict the bins reach, save what no JSON Schema can express across two values, which the bins refuse:

- a Rule switched both on and off
- a feature entry outside its root
- two features with one name or sharing a root

A key the schema does not name is refused, not ignored, so a misspelt `sources` cannot switch the Effect rules off unnoticed.

## Globs

A glob in `sources` starts at the repository root, names a directory first, uses `*` only within a segment and `**` only as a whole one, and ends in a file name with an extension.
Those are the globs oxlint, the language service and git all read alike.
oxlint matches `*.ts` at any depth where the other two match it at the root alone, so the schema refuses it, and `**/*.ts` means every depth to all three.
The language service matches nothing for `src/**` and oxlint nothing for `src/lib`, so the schema refuses both, and `src/**/*.ts` and `src/lib/*.ts` say it to all three.

## Keys moved from package.json

A repository with no `quality.json` still has `ciWiring` and `commitIdentity` read from `package.json`, with a notice on each read.
One with both files exits 2 until `package.json` drops them.
The keys map one for one:

<!-- generated legacy-keys: bun run build writes it from LegacyManifest in scripts/quality-file.ts, QUALITY_FILE in scripts/gates.ts and scripts/doc-blocks.ts -->

| `package.json` | `quality.json` |
| --- | --- |
| `ciWiring.gates` | `gates.ci` |
| `ciWiring.scheduled` | `gates.scheduled` |
| `ciWiring.lintGates` | `gates.lint` |
| `ciWiring.defaultBranch` | `defaultBranch` |
| `commitIdentity` | `commitIdentity` |

<!-- end generated legacy-keys -->

## Related topics

- [checks-quality](../gates/checks-quality.md)
- [Why it is shaped this way](../design.md)
