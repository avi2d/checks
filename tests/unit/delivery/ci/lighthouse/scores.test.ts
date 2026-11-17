import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import { median, reportName, type Scores, scoresOf, summaryTable } from "../../../../../src/delivery/ci/lighthouse/scores.ts";

describe("median", () => {
  test("a median of an odd count that is not the middle value, as a mean would give, fails", () => {
    expect(median([97, 96, 97])).toEqual(Option.some(97));
    expect(median([100, 40, 100])).toEqual(Option.some(100));
  });

  test("a median of an even count that is not the mean of the two middle values fails", () => {
    expect(median([88, 90, 89, 100])).toEqual(Option.some(89.5));
  });

  test("a median of no values that is a number fails", () => {
    expect(median([])).toEqual(Option.none());
  });
});

describe("scoresOf", () => {
  test("scores kept as Lighthouse's fractions rather than whole percents, or a missing score read as zero, fail", () => {
    const report = {
      categories: { performance: { score: 0.974 }, accessibility: { score: 1 }, "best-practices": { score: null }, seo: { score: 0.69 } },
    };
    expect(scoresOf(report)).toEqual({ performance: 97, accessibility: 100, "best-practices": null, seo: 69 });
  });
});

const run = (performance: number, accessibility: number, bestPractices: number | null, seo: number): Scores => ({
  performance,
  accessibility,
  "best-practices": bestPractices,
  seo,
});

describe("summaryTable", () => {
  test("a table whose cells are not the median with each run after it, or whose columns are out of the four categories' order, fails", () => {
    const table = summaryTable([{ page: "/", runs: [run(97, 100, 100, 100), run(97, 100, 100, 100), run(96, 100, 100, 100)] }], 3);
    expect(table).toBe(
      [
        "## Lighthouse",
        "",
        "Each score is the median of 3 runs, each run in brackets. The scores are advice: none of them fails the step.",
        "",
        "| Page | Performance | Accessibility | Best practices | SEO |",
        "| --- | --- | --- | --- | --- |",
        "| `/` | 97 (97, 97, 96) | 100 (100, 100, 100) | 100 (100, 100, 100) | 100 (100, 100, 100) |",
        "",
      ].join("\n"),
    );
  });

  test("a single run shown with a bracket of itself, or a category no run scored shown as a number, fails", () => {
    const table = summaryTable([{ page: "/about/", runs: [run(88, 100, null, 69)] }], 1);
    expect(table).toContain("Each score is one run.");
    expect(table).toContain("| `/about/` | 88 | 100 | none | 69 |");
  });

  test("a run without a score that pulls the median toward zero fails", () => {
    expect(summaryTable([{ page: "/", runs: [run(90, 100, 100, 100), run(92, 100, null, 100)] }], 2)).toContain("| 100 (100, none) |");
  });

  test("a page holding a pipe that splits the table row fails", () => {
    expect(summaryTable([{ page: "/a|b.html", runs: [run(1, 2, 3, 4)] }], 1)).toContain("| `/a\\|b.html` | 1 | 2 | 3 | 4 |");
  });
});

describe("reportName", () => {
  test("report names that collide across pages or runs, or that keep a slash, fail", () => {
    const names = [reportName(1, "/", 1), reportName(1, "/", 2), reportName(2, "/a/b/", 1), reportName(3, "/a_b/", 1)];
    expect(names).toEqual(["01-index-run-1.json", "01-index-run-2.json", "02-a_b-run-1.json", "03-a_b-run-1.json"]);
  });
});
