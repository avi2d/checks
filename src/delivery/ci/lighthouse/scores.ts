import { Option, Schema } from "effect";

const CategoryScore = Schema.Struct({ score: Schema.NullOr(Schema.Finite) });

export const Report = Schema.Struct({
  categories: Schema.Struct({
    performance: CategoryScore,
    accessibility: CategoryScore,
    "best-practices": CategoryScore,
    seo: CategoryScore,
  }),
});

type Category = keyof (typeof Report.Type)["categories"];

const COLUMNS = [
  ["performance", "Performance"],
  ["accessibility", "Accessibility"],
  ["best-practices", "Best practices"],
  ["seo", "SEO"],
] as const satisfies readonly (readonly [Category, string])[];

export const CATEGORY_IDS = COLUMNS.map(([category]) => category);

export type Scores = Readonly<Record<Category, number | null>>;

export type PageScores = { readonly page: string; readonly runs: readonly Scores[] };

const percent = (score: number | null) => (score === null ? null : Math.round(score * 100));

export function scoresOf({ categories }: typeof Report.Type): Scores {
  return {
    performance: percent(categories.performance.score),
    accessibility: percent(categories.accessibility.score),
    "best-practices": percent(categories["best-practices"].score),
    seo: percent(categories.seo.score),
  };
}

export function median(values: readonly number[]): Option.Option<number> {
  const sorted = values.toSorted((a, b) => a - b);
  const upper = sorted[Math.floor(sorted.length / 2)];
  const lower = sorted[Math.ceil(sorted.length / 2) - 1];
  return upper === undefined || lower === undefined ? Option.none() : Option.some((upper + lower) / 2);
}

const shown = (score: number | null) => (score === null ? "none" : String(score));

function cell(runs: readonly Scores[], category: Category): string {
  const scores = runs.map((run) => run[category]);
  const middle = Option.match(median(scores.filter((score) => score !== null)), { onNone: () => "none", onSome: String });
  return scores.length > 1 ? `${middle} (${scores.map(shown).join(", ")})` : middle;
}

const pageCell = (page: string) => `\`${page.replaceAll("|", "\\|")}\``;

export function summaryTable(results: readonly PageScores[], runs: number): string {
  const runText = runs === 1 ? "one run" : `the median of ${String(runs)} runs, each run in brackets`;
  return [
    "## Lighthouse",
    "",
    `Each score is ${runText}. The scores are advice: none of them fails the step.`,
    "",
    `| Page | ${COLUMNS.map(([, title]) => title).join(" | ")} |`,
    `| --- |${" --- |".repeat(COLUMNS.length)}`,
    ...results.map(({ page, runs: pageRuns }) => `| ${pageCell(page)} | ${COLUMNS.map(([category]) => cell(pageRuns, category)).join(" | ")} |`),
    "",
  ].join("\n");
}

export function reportName(pageOrdinal: number, page: string, run: number): string {
  const slug = page.replace(/^\/|\/$/g, "").replaceAll("/", "_") || "index";
  return `${String(pageOrdinal).padStart(2, "0")}-${slug}-run-${String(run)}.json`;
}
