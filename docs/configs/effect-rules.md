# The Effect rules

The oxlint base and Effect language service check paths a repository writes with Effect.

## Oxlint override

The shared `oxlintrc.json` loads `effect-channel/no-error-channel-escape` across the tree.
The repo's `.oxlintrc.json` owns its Effect paths and exemptions in an override:

```json
{
  "extends": ["./node_modules/@avi2dg/checks/oxlintrc.json"],
  "plugins": ["typescript", "oxc", "eslint", "import"],
  "overrides": [{
    "files": ["src/**/*.ts"],
    "excludeFiles": ["src/host/*.ts"],
    "plugins": ["typescript", "oxc", "eslint", "import", "node", "promise", "unicorn"],
    "rules": {
      "node/no-sync": "error",
      "oxc/no-async-await": "error",
      "promise/avoid-new": "error",
      "unicorn/no-process-exit": "error",
      "effect-channel/no-throw": "error",
      "effect-channel/no-try-catch": "error"
    }
  }]
}
```

The kit ships the rule block in `presets/effect.oxlint.json` for copying into the override.
Each config in an oxlint `extends` chain sets `plugins` explicitly, because an omitted list enables defaults across the chain.
`unicorn/no-process-exit` does not check a shebang script, so a bin can use `eslint/no-restricted-properties` for `process.exit`.

## Language service

The repository's `tsconfig.json` holds its Effect override under `compilerOptions.plugins`.
The override includes the same source paths and excludes the same exempt paths as oxlint.
The kit ships severity values in `presets/effect.language-service.json` for the override's `options`.
The kit's `tsconfig.effect.json` keeps the shared language service diagnostics.

## Related topics

- [The TypeScript rules](typescript-rules.md)
- [Native settings](native-settings.md)
