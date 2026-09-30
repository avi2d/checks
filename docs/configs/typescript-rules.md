---
kind: reference
audience: consumers
---
# The TypeScript rules

The oxlint base config and the tsconfig fragment hold a repository's TypeScript to a set of rules, and some of them need type information.

## Syntax rules

`oxlintrc.json` turns on the `correctness` and `suspicious` categories as errors, and these rules on top of them:

- `typescript/no-explicit-any` refuses an `any` type written out.
- `typescript/ban-ts-comment` refuses `@ts-ignore`, `@ts-expect-error` and `@ts-nocheck`.
- `typescript/no-inferrable-types` refuses a type annotation on a variable or a parameter default whose literal initializer already gives the type.
- `typescript/explicit-module-boundary-types` refuses an exported function without a return type, and an exported function parameter typed `any`.
- `typescript/no-non-null-assertion` refuses the non-null assertion `!`.
- `eslint/no-unused-vars` refuses a variable, a parameter or an import nothing reads, and passes over a variable or a parameter whose name starts with `_` and the siblings of a rest property.

The base turns off `typescript/consistent-return`, which its categories would otherwise turn on.
It turns on `effect-channel/no-error-channel-escape` as well, and [The Effect rules](effect-rules.md) says what that rule refuses.

## Type-aware rules

These rules read the types, so they run only under `oxlint --type-aware` with `oxlint-tsgolint` installed.
Without the flag, oxlint skips them and reports nothing about them.

- `typescript/switch-exhaustiveness-check` refuses a `switch` over a union that leaves a member without a case.
- `typescript/prefer-readonly` refuses a private member that nothing reassigns and that is not `readonly`.
- `typescript/no-unnecessary-condition` refuses a condition whose type makes its result always the same, such as `??` on a value that cannot be null, and passes over a constant loop condition.
- `typescript/no-unnecessary-type-parameters` refuses a type parameter the signature uses only once.
- `typescript/use-unknown-in-catch-callback-variable` refuses a rejection callback whose parameter is not typed `unknown`.
- `typescript/no-unsafe-type-assertion` refuses an `as` that narrows a value to a type the compiler cannot prove.
- `typescript/no-deprecated` refuses a use of a symbol whose declaration carries a `@deprecated` tag, in the repository's own code or in a package's types, and repeats the tag's text.

## Data-shape rules

The base loads the kit's `data-shape` plugin from `dist/` with one rule for every TypeScript file and one for production files.

- `data-shape/readonly-collection-param` refuses a parameter typed `T[]`, `Array<T>`, `Map` or `Set` that the function never mutates, stores, returns or passes on, and passing it to a readonly parameter of a function declared in the same file does not count as passing it on.
- Type such a parameter `readonly T[]`, `ReadonlyArray<T>`, `ReadonlyMap` or `ReadonlySet`.
- `data-shape/schema-twin` refuses an object type whose fields match a `Schema.Struct`, `TaggedStruct` or `Class` in the same file by name, count, optionality and kind.
- Derive such a type from the schema with `typeof Name.Type` instead of writing both.
- The twin rule runs on production files only, so a test that declares its own schema as an oracle stays green.

## Astro rules

An override in `oxlintrc.json` turns on one rule of the kit's `readability` plugin in each `.astro` file:

- `readability/thin-astro` refuses a statement in the frontmatter or a script block that is neither an import, a re-export from another module, a type or interface declaration, nor a variable read from `Astro.props`.
- A default inside an `Astro.props` destructuring passes only when it is a literal, a `-` or `+` on a numeric literal, or a name read from `Astro.props` earlier, in the same pattern or a statement before it, so `const { title = "Home", heading = title } = Astro.props;` passes and a call or `await` in a default is refused.
- Move a refused statement into a `.ts` file and import it, so the `.astro` file holds only imports, props and markup.
- A script block loads client code with a side-effect import, as in `<script>import "../client.ts";</script>`, and the override turns off `import/no-unassigned-import` so that import passes.
- A dynamic route re-exports `getStaticPaths` from a `.ts` file, as in `export { getStaticPaths } from "../lib/paths.ts";`.

## Rules outside tests

An override in `oxlintrc.json` turns on these type-aware rules in each `.ts` and `.tsx` file outside `tests/`:

- `typescript/no-unsafe-assignment` refuses assigning an `any` value to a variable, a property or a destructured name.
- `typescript/no-unsafe-member-access` refuses reading a member of an `any` value.
- `typescript/no-unsafe-argument` refuses passing an `any` value to a parameter of another type.
- `typescript/no-unsafe-return` refuses returning an `any` value from a function, unless the function returns `unknown`.
- `typescript/no-unsafe-call` refuses calling an `any` value.

A consumer inherits the override through `extends`, and a file under `tests/` answers to none of the five.

## Compiler options

`tsconfig.effect.json` sets these compiler options in each repository whose `tsconfig.json` extends it:

- `erasableSyntaxOnly` refuses TypeScript syntax that does not erase to JavaScript, such as an `enum` or a parameter property.
- `exactOptionalPropertyTypes` refuses `undefined` as the value of an optional property whose type does not name `undefined`, so a type derived from a `Schema.optionalKey` field accepts only a missing key, as the schema does.

## ts-reset rules

`tsconfig.effect.json` lists the kit's `ts-reset.d.ts` in `files`, and that file loads two rules of `@total-typescript/ts-reset`, a dependency of the kit:

- `is-array` types the array `Array.isArray` narrows a value to as `unknown[]` rather than `any[]`.
- `json-parse` types the value `JSON.parse` returns as `unknown` rather than `any`.

tsc then refuses code that uses either value as a type it has not checked.
The fragment also sets `include` to every file under the directory of the repository's `tsconfig.json` and to `ts-reset.d.ts`.
A repository whose `tsconfig.json` sets `include` or `files` but not both keeps both rules.
A repository that sets only `files` also gets every file under that directory in its program.
A repository that sets both `files` and `include` drops both rules, and `checks-lint-coverage` fails it.

## Related topics

- [The Effect rules](effect-rules.md)
- [The dependency rules](dependency-rules.md)
- [Why it is shaped this way](../design.md)
