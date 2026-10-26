---
kind: reference
audience: consumers
---
# The dependency rules

The kit's dependency-cruiser rules hold a repository's imports, and a repository adds its own boundaries on top.

## Base rules

`defineConfig` from `@avi2dg/checks/dependency-cruiser` returns these rules, with or without a config of the repository's own:

- `no-circular`
- `no-orphans`, which a repository that depends on `astro` gets only by listing its own, as [checks-imports](../gates/checks-imports.md) explains
- `not-to-dev-dep`, which refuses shipped source importing a dev-only package, and a package listed in `peerDependencies` too is not dev-only
- `no-non-package-json`, which refuses an import of an installed package that the nearest `package.json` does not declare, and counts a peer that `peerDependenciesMeta` marks optional as declared
- `not-to-unresolvable`, which refuses a specifier nothing installed answers
- `no-deep-imports`, which refuses a subpath the package's exports map does not publish

A test file, a config file and every path under `tests/` may import a dev-only package.

The rules parse with swc, so the cruise needs `@swc/core` installed, and without it the cruise silently skips every `.ts` file.

`no-deep-imports` judges the import specifier, never the file it resolves to.
The rules honour `exports` maps, so a subpath the map publishes resolves and passes, and a subpath it omits fails to resolve and is reported.
A package without an `exports` map publishes every file.
A bare import always passes, whatever file its entry lives in.
A repository that sets its own `options.enhancedResolveOptions` replaces the kit's, and restates `exportsFields` and `conditionNames` in it.

## A repository's own config

A repository writes `dependency-cruiser.config.ts` when the defaults do not fit:

```ts
import { defineConfig } from "@avi2dg/checks/dependency-cruiser";

export default defineConfig({
  // A launcher script loads the bin by path, so nothing imports it.
  orphans: ["^src/bin[.]ts$"],
  devOnly: ["^(?:evals|tests)/"],
  forbidden: [
    {
      name: "ui-cannot-reach-server",
      severity: "error",
      from: { path: "^src/ui" },
      to: { path: "^src/server" },
    },
  ],
  options: { exclude: { path: ["^dist/"] } },
});
```

The builder takes dependency-cruiser's own config without `extends`, plus two keys of its own:

- `devOnly` lists the paths that may import a dev dependency, and replaces the default `["^tests/"]`.
- `orphans` lists the entry points `no-orphans` passes over.

A rule under `forbidden` that takes a kit rule's name replaces that rule whole, and any other rule is added after the kit's.
`options.exclude` joins the kit's `^repos/`, which keeps the cruise out of the libraries `checks-vendor` links, and every other option replaces the kit's of the same name.
`tsc` refuses an `extends` key and a severity dependency-cruiser does not know.

## Running it

`checks-lint` runs [checks-imports](../gates/checks-imports.md), which cruises every tracked TypeScript file against `dependency-cruiser.config.ts`, or against the kit's defaults when the repository holds no config.

## Related topics

- [checks-imports](../gates/checks-imports.md)
- [Why it is shaped this way](../design.md)
