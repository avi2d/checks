---
governs: [src/quality/presets/stylelint.ts, src/quality/frontend-syntax.ts]
---
# 0004. The CSS families ship on, and the design tokens stay opt-in

Date: 2026-10-18

## Status

Accepted.

## Context

The kit needed a default for each family of CSS rules before `checks-frontend-syntax` was built.
The candidates were stylelint's correctness and convention configs, selector complexity limits, design token rules, a Baseline browser target and a check on rendered token values.
A design token rule renames every custom property a repository already has, so turning it on by default breaks each existing stylesheet at once.
A repository's browser target is a product call, so the kit cannot pick one target for all of them.

## Decision

The correctness, convention, selector complexity and Baseline families are on in every repository that declares `frontend-syntax.json`.
The design token family stays off until the repository's `tokens` option names its token files.
Token checks rest on those source rules alone, and no check reads rendered token values.
Each repository sets its own Baseline target through `baseline`.
The kit holds plain CSS, and a CSS-in-TypeScript compiler is not a path it supports.

## Consequences

A repository adopting the gate meets the four families at once and the token rules only when it opts in.
`defineConfig` refuses a config with no `baseline` or no `tokens`, so each repository writes both choices down.
