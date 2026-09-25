# The dependency rules

The shared dependency-cruiser base holds a repository's imports to a set of rules every repository shares, and a reader looks it up to add a boundary of its own.

## Base rules

`.dependency-cruiser.cjs` extends the shared base, which carries these rules:

- `no-circular`
- `no-orphans`
- `not-to-dev-dep`, which refuses shipped source importing a dev-only package, and a package listed in `peerDependencies` too is not dev-only
- `no-non-package-json`, which refuses an import of an installed package that the nearest `package.json` does not declare
- `not-to-unresolvable`, which refuses a specifier nothing installed answers
- `no-deep-imports`, which refuses a subpath the package's exports map does not publish

The base parses with swc, so it needs `@swc/core` installed, and without it the cruise silently skips every `.ts` file.

## Boundaries

A repository appends a named rule per boundary it owns:

```js
module.exports = {
  extends: "./node_modules/@avi2dg/checks/dependency-cruiser.config.js",
  forbidden: [
    {
      name: "ui-cannot-reach-server",
      severity: "error",
      from: { path: "^src/ui" },
      to: { path: "^src/server" },
    },
  ],
};
```

A rule that restates a base name overrides it field by field.
That is how an entry point stops being an orphan: redeclare `no-orphans` with the entry added to its `pathNot`.
A repository that declares feature owners spreads the rules `quality.json` compiles to into the same `forbidden`, as [checks-feature-owners](../gates/checks-feature-owners.md#import-boundary) says.

## Running it

`package.json` gains the script:

```json
"lint:deps": "depcruise --config .dependency-cruiser.cjs src"
```

CI runs it beside the other checks:

```yaml
jobs:
  lint:
    steps:
      - uses: actions/checkout@v5
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun run lint:deps
```

## Related topics

- [checks-feature-owners](../gates/checks-feature-owners.md)
- [Why it is shaped this way](../design.md)
