# 0001. The size budget holds cognitive complexity at 15

Date: 2026-09-25

## Status

Accepted.

## Context

The size budget's complexity limit used oxlint's cyclomatic complexity rule.
An evaluation across four repositories with code compared that rule against cognitive complexity on 21 hard to read functions.
Cognitive complexity flagged the tangled functions that cyclomatic complexity passed, and passed the flat guard lists that cyclomatic complexity flagged.
15 of the 21 functions kept passing every size rule under cyclomatic complexity alone.
A switch with twenty cases and a file of fifteen flat guards both passed under the new rule, while a nest sixteen deep in cognitive terms failed it.

The rule is written from SonarSource's published Cognitive Complexity paper alone, version 1.7, and cites its sections below.
No SonarSource implementation source was read or copied, which keeps LGPL-3.0 code out of the MIT kit.

## Decision

The kit's own oxlint JS plugin carries a cognitive complexity rule, and the size budget's complexity limit at 15 holds functions to it in production and test code.
The rule follows Appendix B of the paper: B1 increments for breaks in linear flow, B2 nesting levels, and B3 nesting increments.
Structurally it counts `if`, ternary operators, `switch`, `for`, `while`, `do while` and `catch` with a nesting increment, as the paper's Increment for breaks in the linear flow, Catches and Switches sections say.
`else` and `else if` cost one flat increment and raise the nesting without taking a nesting increment of their own, as the Hybrid increment type says.
Sequences of `&&` and `||` cost one per run of like operators, as the Sequences of logical operators section says, with parenthesised runs counted apart.
Labelled `break` and `continue` cost one each, as the Jumps to labels section says, while plain jumps and early returns cost nothing.
Direct self calls cost one, as the Recursion section says.
Nullish coalescing, optional chaining and logical assignment cost nothing, as the Ignore shorthand section says.

Four paper points are deliberately narrowed.
Recursion is detected only for a direct self call, by name for a function or variable and through `this` for a method or field, since indirect cycles need whole program analysis beyond a lint rule.
Top level statements are not scored, matching the cyclomatic rule the new one replaces, with the file lines limit covering them.
The compensating usages of Appendix A target COBOL, pre module JavaScript and Python decorators, so none of them applies to the TypeScript the kit holds.
Every function, method, lambda and static block scores on its own from zero nesting, and a nested one adds nothing to the function that encloses it.
The evaluation measured each function apart, as the cyclomatic rule the new one replaces scores them, so a `describe` callback holding flat tests or a component holding handlers is not charged for its callbacks.
The paper's Increment for nested flow-break structures section instead sums a nested function into its parent one level deeper.

## Consequences

`effect-channel/cognitive-complexity` replaces oxlint's `complexity` in the size budget configuration, which now loads the kit's own plugin bundle to reach it.
The quality schema and the size budget docs name the new rule and its limit.
The paper's worked examples for the word list, the prime sieve, the nested method, the pattern compiler, the model save and the symbol lookup are unit and end to end tests.
Each scores what the paper's Appendix C prints, except that the nested method and the model save score their nested functions apart.
Checks' own code passes under the new rule.
Consumer repositories get the tighter limit on their next pull request with no configuration change.
