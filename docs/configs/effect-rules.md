---
kind: reference
audience: consumers
---
# The Effect rules

The oxlint base and Effect language service check paths a repository writes with Effect.

## Oxlint override

The kit's oxlint `base` loads `effect-channel/no-error-channel-escape` across the tree.
`effect` in `oxlint.config.ts` names the paths that hold the six Effect rules, and has no default:

| `effect` | The Effect rules hold |
| --- | --- |
| `true` | every source file outside the tests |
| `false` | no file |
| `{ excludeFiles }` | every source file outside the tests, less these globs |
| `{ files, excludeFiles }` | these globs, less `excludeFiles`, with at least one glob in `files` |

`files` and `excludeFiles` read as they do in an oxlint override.
Every source file is `SOURCES`, the `.ts`, `.tsx`, `.mts` and `.cts` files, and the tests are `TESTS`, the files under `tests/` and each `*.test.ts` or `*.test.tsx`.
A comment beside an excluded glob says why that path stays outside Effect:

```ts
import { defineConfig } from "@avi2dg/checks/oxlint";

export default defineConfig({
  effect: {
    excludeFiles: [
      // Launchd runs the renamer, and it cannot import Effect v4.
      "home/.config/renamer/**",
    ],
  },
});
```

A config that leaves `effect` out, sets it to a string or gives `files` no glob fails `tsc`, and oxlint refuses it again when it loads the file.
`effectRules(files, excludeFiles)` from the same module returns the override itself:

```ts
{
  files: ["src/**/*.ts"],
  excludeFiles: ["src/host/*.ts"],
  plugins: ["typescript", "oxc", "eslint", "import", "node", "promise", "unicorn"],
  rules: {
    "node/no-sync": "error",
    "oxc/no-async-await": "error",
    "promise/avoid-new": "error",
    "unicorn/no-process-exit": "error",
    "effect-channel/no-throw": "error",
    "effect-channel/no-try-catch": "error"
  }
}
```

`unicorn/no-process-exit` does not check a shebang script, so a bin can use `eslint/no-restricted-properties` for `process.exit`.

## Language service

The repository's `tsconfig.json` holds its Effect override under `compilerOptions.plugins`.
[checks-effect-scope](../gates/checks-effect-scope.md) writes that override from `oxlint.config.ts`, so it includes and excludes the same paths as oxlint.
The override takes its `options` from the severity values the kit ships in `src/quality/presets/effect.language-service.json`.
The preset turns these diagnostics to errors:

- `nodeBuiltinImport` refuses an import of a Node built-in module that has an Effect counterpart.
- `asyncFunction` refuses an `async` function.
- `newPromise` refuses `new Promise`.
- `extendsNativeError` refuses a class that extends the native `Error` directly.
- `processEnv` refuses a read of `process.env` outside an Effect generator.
- `processEnvInEffect` refuses a read of `process.env` inside an Effect generator.

Effect's `Config` reads the environment in place of `process.env`.
The kit's `tsconfig.effect.json` keeps the shared language service diagnostics.
A repository whose `tsconfig.json` holds its own plugin entry holds those severities in that entry too, since its entry stands in for the kit's.
An entry `checks-effect-scope` creates carries the `diagnosticSeverity` of `tsconfig.effect.json`, and an entry the repository wrote keeps its own settings.

## Related topics

- [The TypeScript rules](typescript-rules.md)
- [Native settings](native-settings.md)
- [checks-effect-scope](../gates/checks-effect-scope.md)
