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
      // The host loads this entry outside the Effect runtime.
      "src/host/**",
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

## Error-channel refusals

`effect-channel/no-error-channel-escape` refuses these combinators:

| Combinator | Refused use |
| --- | --- |
| `ignore`, `ignoreCause` | Every value reference, because both failure and success become an indistinguishable success |
| `catchCause` | Every value reference, because recovery includes typed errors, defects, and interruption |
| `catchCauseIf`, `catchCauseFilter` | Every value reference, because matching causes can include defects or interruption, though unmatched causes still fail |
| `catch`, `catchEager`, `orElseSucceed` | A direct call whose inline handler has no parameters or does not read its first identifier parameter |

The handler check covers both data-first and piped calls.
The rule follows the `Effect` export from `effect` and namespace or named imports from `effect/Effect`, including renamed imports.
It follows const namespace aliases and const destructures, including renamed bindings.
Member access and destructures accept static string keys and template literals without substitutions.
Scope resolution keeps unrelated parameters and locals outside the rule.
Type queries, dynamic keys, and aliases or destructures declared with `let` or `var` are not checked.

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
The kit's `tsconfig.effect.json` holds the shared language service diagnostics.
It turns off `catchAllToMapError`, `catchToIgnore`, and `catchToOrElseSucceed`.
A mixed cause can make `Effect.catch` and `Effect.mapError` produce different failures.
`catchToIgnore` suggests `Effect.ignore`, which the oxlint base refuses.
`catchToOrElseSucceed` turns a blind `Effect.catch` fallback, which the oxlint base refuses, into `Effect.orElseSucceed`, the same blind recovery under another name.
With `effect: false`, the shared diagnostics still run, but the plugin has no scoped overrides.
A plugin entry in the repository's `tsconfig.json` stands in for the kit's, so `checks-effect-scope` writes those severities into it on every run.
The kit owns the severities of its own keys, and a repository adds keys of its own but does not change the kit's.

## Related topics

- [The TypeScript rules](typescript-rules.md)
- [Native settings](native-settings.md)
- [checks-effect-scope](../gates/checks-effect-scope.md)
