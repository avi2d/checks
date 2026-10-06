import { Effect } from "effect";
import type { Page } from "playwright-core";
import { attempt } from "./page.ts";

const CONTENT_MODEL = "element-permitted-content";

type NestingReport = {
  readonly found: readonly string[];
  readonly elements: number;
};

// The rendered DOM rather than the served file, so markup a script builds is judged too.
export const judgeNesting = Effect.fn("judgeNesting")(function* (page: Page) {
  const { HtmlValidate } = yield* attempt("cannot load html-validate, which a product that runs the nesting check installs beside the kit", () =>
    import("html-validate"),
  );
  const html = yield* attempt("cannot read the rendered page", () => page.content());
  const elements = yield* attempt("cannot count the elements", () => page.locator("*").count());
  const validator = new HtmlValidate({ rules: { [CONTENT_MODEL]: "error" } });
  const { results } = yield* attempt("html-validate cannot judge the page", () => validator.validateString(html));
  const found = results.flatMap(({ messages }) => messages.map(({ line, column, message }) => `${message} at ${line}:${column} of the rendered page`));
  return { found, elements } satisfies NestingReport;
});
