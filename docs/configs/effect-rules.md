# The Effect rules

The oxlint base config and the tsconfig fragment hold a repository's Effect code to its error channel and to Effect-native IO, and a reader looks them up to learn what each rule refuses and how a path opts in.

## Base config

The base config, `oxlintrc.json`, loads the `effect-channel` plugin and turns on `effect-channel/no-error-channel-escape`.
That rule refuses `Effect.ignore`, `Effect.ignoreCause`, the `Effect.catchCause` family, and an `Effect.catch` whose handler takes no error or names it `_`.

Two more rules ship off, because a repository writes only some of its paths in Effect, and code a host loads without `node_modules`, such as a hook bundle or this oxlint plugin, cannot import it:

- `effect-channel/no-throw` refuses a `throw` statement.
- `effect-channel/no-try-catch` refuses a `try` statement with a `catch` clause, and `try`/`finally` stays allowed.

Each refusal says what to write instead: a `Schema.TaggedError` failed through `Effect.fail`, a throwing call wrapped in `Effect.try` or `Effect.tryPromise`, and recovery by tag with `Effect.catchTag`.

## Effect paths

A repository turns the rules on for the paths it writes in Effect by declaring those paths in `quality.json` and extending the fragments [checks-quality](../gates/checks-quality.md) generates:

```json
"sources": {
  "effect": { "paths": ["src/**/*.ts"], "exempt": ["src/host/*.ts"] }
}
```

The fragment's override carries the kit's Effect rule block, `presets/effect.oxlint.json`.
It holds the two rules above, plus `node/no-sync`, `oxc/no-async-await`, `promise/avoid-new` and `unicorn/no-process-exit`.
Files under `exempt` answer to none of them.

oxlint resolves `files` against the directory of the config that holds the override, so a config passed with `-c` from outside the repository matches nothing and reports nothing.

`unicorn/no-process-exit` passes over any file that opens with a shebang.
A repository whose bins open with one bans `process.exit` itself with `no-restricted-properties` in its own `.oxlintrc.json`, as the kit's own repository does.
The preset leaves that rule out because a repository's own `no-restricted-properties` list for the same files would replace it, or be replaced by it.
The [checks-suppressions-ratchet](../gates/checks-suppressions-ratchet.md) gate refuses new suppressions.

## Language service

The language service holds the same paths to Effect-native IO through the tsconfig fragment's override, whose severities are `presets/effect.language-service.json`.
`nodeBuiltinImport`, `asyncFunction`, `newPromise` and `extendsNativeError` are all errors.
effect-tsgo keeps the severities `tsconfig.effect.json` sets when a later config in `extends` restates the plugin with only its overrides.

## Related topics

- [checks-quality](../gates/checks-quality.md)
- [The quality file](quality-file.md)
- [Why it is shaped this way](../design.md)
