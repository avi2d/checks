import { Effect } from "effect";
import { attempt } from "./page.ts";

type HtmlReport = {
  readonly found: readonly string[];
};

// The presets leave input-missing-label off, so it is set beside them.
export const judgeHtml = Effect.fn("judgeHtml")(function* (url: string) {
  const { HtmlValidate } = yield* attempt("cannot load html-validate, which a product that runs the html check installs beside the kit", () =>
    import("html-validate"),
  );
  const html = yield* attempt(`cannot fetch ${url}`, () => fetch(url).then((response) => response.text()));
  const validator = new HtmlValidate({
    extends: ["html-validate:standard", "html-validate:a11y"],
    rules: { "input-missing-label": "error" },
  });
  const { results } = yield* attempt("html-validate cannot judge the page", () => validator.validateString(html, url));
  const found = results.flatMap(({ messages }) => messages.map(({ ruleId, line, column, message }) => `${ruleId} at ${String(line)}:${String(column)}: ${message}`));
  return { found } satisfies HtmlReport;
});
