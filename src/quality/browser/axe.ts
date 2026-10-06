import { Effect } from "effect";
import type { Page } from "playwright-core";
import { attempt } from "./page.ts";

const WCAG_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const CONTRAST = "color-contrast";

type AxeReport = {
  readonly found: readonly string[];
  readonly unverified: readonly string[];
  readonly rules: number;
};

type Node = { readonly target: readonly unknown[]; readonly any: readonly { readonly message: string }[] };

function where(node: Node): string {
  return node.target.map(String).join(" ");
}

export const judgeAxe = Effect.fn("judgeAxe")(function* (page: Page) {
  const { AxeBuilder } = yield* attempt("cannot load @axe-core/playwright, which a product that runs the axe check installs beside the kit", () =>
    import("@axe-core/playwright"),
  );
  const results = yield* attempt("axe cannot analyse the page", () => new AxeBuilder({ page }).withTags(WCAG_AA).analyze());
  const found = results.violations.flatMap((violation) =>
    violation.nodes.map((node) => `${violation.id} (${violation.impact ?? "unknown"}): ${where(node)}: ${violation.help}`),
  );
  const unverified = results.incomplete
    .filter(({ id }) => id === CONTRAST)
    .flatMap(({ nodes }) => nodes.map((node) => `${CONTRAST} unverified: ${where(node)}: ${node.any[0]?.message ?? "axe cannot measure it"}`));
  return { found, unverified, rules: results.passes.length + results.violations.length + results.incomplete.length } satisfies AxeReport;
});
