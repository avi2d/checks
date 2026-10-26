---
kind: how-to
audience: consumers
---
# Turn on the CSS families

A repository owner follows these steps to judge the repository's CSS with the stylelint families it needs.

## Turn them on

To turn on the CSS families:

1. Install the peers [checks-frontend-syntax](../gates/checks-frontend-syntax.md#what-it-reads) loads, with the `bun add` line on its page.
1. Declare `frontend-syntax.json`, which turns the gate on, as its page says.
1. Write `stylelint.config.ts` with the families the repository needs:

   ```ts
   import { defineConfig } from "@avi2dg/checks/stylelint";

   export default defineConfig({
     baseline: "widely",
     tokens: ["src/styles/tokens.css"],
     bem: true,
     flatSelectors: true,
     noPageHas: true,
   });
   ```

[checks-frontend-syntax](../gates/checks-frontend-syntax.md#what-it-reads) says what each key takes and which family it turns on.
`noPageHas` sees a `:has` nested under a page selector only together with `flatSelectors`, which refuses the nesting.

## Related topics

- [checks-frontend-syntax](../gates/checks-frontend-syntax.md)
- [checks-css-size](../gates/checks-css-size.md)
