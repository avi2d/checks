# checks-feature-owners

`checks-feature-owners` is the gate that holds each declared feature to a runnable proof and lists the feature owners a change touches, and a reader looks it up to declare a feature.

## What it checks

A repository opts a feature in by declaring, in `quality.json`, the directory it owns, the files code outside it imports it through, the files that may reach past those, and the end-to-end test that proves it runs:

```json
"features": [
  {
    "name": "billing",
    "root": "src/billing",
    "entries": ["src/billing/index.ts"],
    "allowFrom": ["src/main.ts", "src/cli/*.ts"],
    "proof": "tests/e2e/billing.test.ts"
  }
],
"changeSignal": "advisory"
```

`root` is a directory and `entries` are files under it, both without globs.
`allowFrom` holds globs of the same shape as `sources`.
`proof` is a `.test.ts` or `.test.tsx` file under `tests/e2e/`.
Nothing moves, since a root is wherever the feature already lives.
`quality.json` refuses an entry outside its root, a name used twice, and two features sharing a root or one root inside another, so a file has at most one owner.

The gate fails when a feature's proof cannot prove it:

- the proof or an entry is not in the head commit
- the proof does not parse
- the proof imports none of the feature's entries

An import counts when it is a runtime `import`, `export ... from` or `export * from` of a relative path that names an entry.
It names the entry by its own name, by the `.js`, `.jsx`, `.mjs` or `.cjs` spelling of it, or without an extension, the way a directory `index` is imported.
`.js` names a `.tsx` entry as well as a `.ts` one.
`import type` does not count, and neither does a path alias.
The proof runs in `bun run test` like any end-to-end test, which is what shows it passes.

With `changeSignal` set to `advisory` it also lists each owner the range touches, with the paths it touched under the owner's root or at its proof, and still passes.
Whether a change that spans owners is one coherent slice is for a reviewer to judge.
A rename counts at both of its paths.

## What it reads

It reads `features` and `changeSignal` from `quality.json`, each proof and entry from the head commit, and the paths the range touches.

## Arguments

```sh
checks-feature-owners <base-ref> <head-ref>
checks-feature-owners <ref>
```

With two arguments the range starts where the head branched from the base, at their merge-base.
With one it is that commit against its parent, or against the empty tree for a repository's first commit.

## Exit codes

| Code | When |
| --- | --- |
| 0 | every feature's proof imports one of its entries |
| 1 | a feature's proof cannot prove it |
| 2 | `quality.json` does not decode, which is where a proof outside `tests/e2e/` is refused, or a ref does not resolve |

## Sample output

```
feature-owners: 1 problem(s) with the features' runnable proofs:
  billing: proof tests/e2e/billing.test.ts imports none of its entries, src/billing/index.ts
```

With `changeSignal` set to `advisory`:

```
feature-owners: advisory, the range touches 2 feature owner(s); a reviewer judges whether they make one slice:
  billing: src/billing/charge.ts, src/billing/tax.ts
  invoices: src/invoices/tax.ts, tests/e2e/invoices.test.ts
```

## Opting out

A repository that declares no feature passes.
`quality.json` refuses a `changeSignal` without features, which would map a change to no owner.
A repository that tracks no `.ts` or `.tsx` file leaves it out of `gates.lint`, as [Gate selection](checks-lint.md#gate-selection) says.

## Import boundary

`dist/feature-rules.js` compiles `features` into one dependency-cruiser rule per feature, which `.dependency-cruiser.cjs` spreads beside its own:

```js
const { featureRules } = require("@avi2dg/checks/dist/feature-rules.js");

module.exports = {
  extends: "./node_modules/@avi2dg/checks/dependency-cruiser.config.js",
  forbidden: [...featureRules(require("./quality.json"))],
};
```

A module outside a feature's root that imports a file inside it must import one of the feature's `entries`.
Modules under `tests/` and the files `allowFrom` matches, such as a CLI or a harness, may import any file in it:

```
error feature-billing-entries: src/report.ts → src/billing/charge.ts
```

`featureRules` decodes its argument with the schema the bins use and throws the schema's refusal when it does not decode, which stops the cruise.
It is an ES module, as `effect` is, so a `.cjs` config loads it through `require`, which needs node 20.19, 22.12 or later.

## Related topics

- [The dependency rules](../configs/dependency-rules.md)
- [The quality file](../configs/quality-file.md)
