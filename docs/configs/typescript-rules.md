---
kind: reference
audience: consumers
---
# The TypeScript rules

The kit's oxlint base and the tsconfig fragment hold a repository's TypeScript to a set of rules, and some of them need type information.

## Syntax rules

`base` from `@avi2dg/checks/oxlint`, which every config its `defineConfig` returns starts from, turns on the `correctness` and `suspicious` categories as errors, and these rules on top of them:

- `typescript/no-explicit-any` refuses an `any` type written out.
- `typescript/ban-ts-comment` refuses `@ts-ignore`, `@ts-expect-error` and `@ts-nocheck`.
- `typescript/no-inferrable-types` refuses a type annotation on a variable or a parameter default whose literal initializer already gives the type.
- `typescript/explicit-module-boundary-types` refuses an exported function without a return type, and an exported function parameter typed `any`.
- `typescript/no-non-null-assertion` refuses the non-null assertion `!`.
- `eslint/no-unused-vars` refuses a variable, a parameter or an import nothing reads, and passes over a variable or a parameter whose name starts with `_` and the siblings of a rest property.
- `oxc/no-accumulating-spread` refuses a spread of the accumulator inside a `reduce` callback or a loop, as in `[...acc, item]` or `{ ...acc, [key]: value }`.

The base turns off `typescript/consistent-return`, which its categories would otherwise turn on.
It turns on `effect-channel/no-error-channel-escape` as well, and [The Effect rules](effect-rules.md) says what that rule refuses.

## Type-aware rules

These rules read the types, so they run only with `oxlint-tsgolint` installed and type-aware linting on.
`defineConfig` turns it on through `options.typeAware`, so a plain `oxlint` runs them.

- `typescript/switch-exhaustiveness-check` refuses a `switch` over a union that leaves a member without a case.
- `typescript/prefer-readonly` refuses a private member that nothing reassigns and that is not `readonly`.
- `typescript/no-unnecessary-condition` refuses a condition whose type makes its result always the same, such as `??` on a value that cannot be null, and passes over a constant loop condition.
- `typescript/no-unnecessary-type-parameters` refuses a type parameter the signature uses only once.
- `typescript/use-unknown-in-catch-callback-variable` refuses a rejection callback whose parameter is not typed `unknown`.
- `typescript/no-unsafe-type-assertion` refuses an `as` that narrows a value to a type the compiler cannot prove.
- `typescript/no-deprecated` refuses a use of a symbol whose declaration carries a `@deprecated` tag, in the repository's own code or in a package's types, and repeats the tag's text.

## Data-shape rules

The base loads the kit's `data-shape` plugin from `dist/` and turns on `data-shape/no-reduce-accumulator-copy` for every file oxlint lints, and two more of its rules for every TypeScript file, tests included.

- `data-shape/no-reduce-accumulator-copy` refuses a `reduce` or `reduceRight` callback that copies its accumulator on every step.
- The work grows with the square of the input when the accumulator grows with the input.
- It also refuses a copy of an accumulator with a fixed shape, since a syntax rule cannot tell the two apart.
- It refuses `Object.assign` into a new object literal with the accumulator as a source, `Array.from` of the accumulator, and `concat`, `slice`, `toSpliced`, `toSorted`, `toReversed` or `with` called on it.
- It follows a `const` alias of the accumulator, and passes over a name that shadows the accumulator, `Object` or `Array`.
- It refuses an array method only when the reduce starts from an array literal, a name typed as an array, or a `const` that holds one, so a string accumulator's `concat` passes.
- It reads only the callback written inline as the first argument, and passes over a copy inside a function that callback declares.
- Change the accumulator in place, as with `push` or `Object.assign(acc, item)`, and return it.
- `oxc/no-accumulating-spread` holds the spread form of the same copy.

- `data-shape/readonly-collection-param` refuses a parameter typed `T[]`, `Array<T>`, `Map` or `Set` that the function never mutates, stores, returns or passes on, and passing it to a readonly parameter of a function declared in the same file does not count as passing it on.
- Type such a parameter `readonly T[]`, `ReadonlyArray<T>`, `ReadonlyMap` or `ReadonlySet`.
- `data-shape/schema-twin` refuses an object type whose fields match a `Schema.Struct`, `TaggedStruct`, `Class` or `TaggedError` in the same file.
- It compares field names, optionality, supported scalar types and literal values.
- It does not report an object type when any of its fields is one it cannot compare.
- It recognizes `Schema` imported from `effect`, including an alias, and a namespace import of `effect/Schema`.
- Derive such a type from a `Struct` or `TaggedStruct` with `typeof Name.Type` instead of writing both.
- Derive it from a `Class` or `TaggedError` with `typeof Name.Encoded`, the plain object shape rather than the class instance.

The plugin carries a fourth rule that the base leaves off:

- `data-shape/no-shell-in-strings` refuses a string, a template literal, an array of them or a `+` chain of them that holds five or more lines that read as shell, and names the first such line and the count.
- A line reads as shell when `if`, `elif`, `while` or `until` starts the line without a following `(`, when the line is `then`, `fi`, `do`, `done` or `esac`, alone or followed by `;`, when `then` or `do` closes the line after `;`, when the whole line is `case … in`, when it holds `;;`, `$(…)`, `"$@"`, `${NAME}`, `&&` or `||`, when `trap` or `exec` starts the line, or when it is a `#!/bin/sh` line.
- A line that also reads as JavaScript does not count, such as one holding `const`, `=>`, `===` or `console.`, ending in `{` or `(` or in a single `;`, or starting with `}` or `)`, while a `;;` ending still counts as shell, so a script passed to `bun -e` passes.
- Move such a program to a `.sh` file the code runs, where a shell linter reads it.
- An override in `base` keeps it off in every test file `TESTS` names, so a test may still write a fake tool as a `#!/bin/sh` fixture.

A repository turns it on in its `oxlint.config.ts`:

```ts
import { defineConfig } from "@avi2dg/checks/oxlint";

export default defineConfig({ effect: true, rules: { "data-shape/no-shell-in-strings": "error" } });
```

## Astro rules

An override in `base` turns on one rule of the kit's `readability` plugin in each `.astro` file:

- `readability/thin-astro` refuses a statement in the frontmatter or a script block that is neither an import, a re-export from another module, a type or interface declaration, nor a variable read from `Astro.props`.
- A default inside an `Astro.props` destructuring passes only when it is a literal, a `-` or `+` on a numeric literal, or a name read from `Astro.props` earlier, in the same pattern or a statement before it, so `const { title = "Home", heading = title } = Astro.props;` passes and a call or `await` in a default is refused.
- Move a refused statement into a `.ts` file and import it, so the `.astro` file holds only imports, props and markup.
- A script block loads client code with a side-effect import, as in `<script>import "../client.ts";</script>`, and the override turns off `import/no-unassigned-import` so that import passes.
- A dynamic route re-exports `getStaticPaths` from a `.ts` file, as in `export { getStaticPaths } from "../lib/paths.ts";`.

## Rules outside tests

An override in `base` turns on these type-aware rules in each `.ts` and `.tsx` file outside `tests/`:

- `typescript/no-unsafe-assignment` refuses assigning an `any` value to a variable, a property or a destructured name.
- `typescript/no-unsafe-member-access` refuses reading a member of an `any` value.
- `typescript/no-unsafe-argument` refuses passing an `any` value to a parameter of another type.
- `typescript/no-unsafe-return` refuses returning an `any` value from a function, unless the function returns `unknown`.
- `typescript/no-unsafe-call` refuses calling an `any` value.

Every config `defineConfig` returns carries the override, and a file under `tests/` answers to none of the five.

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
