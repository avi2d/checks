---
kind: reference
audience: consumers
---
# The TypeScript rules

The oxlint base config and the tsconfig fragment hold a repository's TypeScript to a set of rules, and a reader looks it up to learn what each rule refuses and which rules need type information.

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

## Related topics

- [The Effect rules](effect-rules.md)
- [The dependency rules](dependency-rules.md)
- [Why it is shaped this way](../design.md)
