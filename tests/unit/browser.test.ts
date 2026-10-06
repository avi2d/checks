import { expect, test } from "bun:test";
import { describeVisit, inconsistencies, targetsOn, visitsOf, type Declaration } from "../../src/quality/browser/declaration.ts";
import { counted, passes, report, type Outcome } from "../../src/quality/browser/report.ts";

const DECLARATION: Declaration = {
  site: "dist",
  routes: [
    { path: "/", locale: "en" },
    { path: "/ru/", locale: "ru" },
  ],
  viewports: [{ name: "phone", width: 375, height: 812, touch: true }],
  states: [{ name: "default" }, { name: "reduced motion", reducedMotion: "reduce" }],
  targets: [
    { name: "language switch", selector: "header a[hreflang]", focusable: true },
    { name: "email contact", selector: "main a[href^='mailto:']", routes: ["/ru/"] },
  ],
  checks: ["layout", "keyboard", "motion"],
};

test("visits cross every route with every viewport and state, and a target applies only to the routes it names", () => {
  expect(visitsOf(DECLARATION).map(describeVisit)).toEqual([
    "/ (en), phone 375x812 touch, default",
    "/ (en), phone 375x812 touch, reduced motion",
    "/ru/ (ru), phone 375x812 touch, default",
    "/ru/ (ru), phone 375x812 touch, reduced motion",
  ]);
  expect(targetsOn(DECLARATION, "/").map(({ name }) => name)).toEqual(["language switch"]);
  expect(targetsOn(DECLARATION, "/ru/").map(({ name }) => name)).toEqual(["language switch", "email contact"]);
});

test("a consistent declaration has no inconsistency", () => {
  expect(inconsistencies(DECLARATION)).toEqual([]);
});

test("a declaration that repeats a name, names an undeclared route or enables a check nothing can feed is refused, naming each problem", () => {
  const contradicting: Declaration = {
    ...DECLARATION,
    routes: [...DECLARATION.routes, { path: "/", locale: "en" }],
    viewports: [...DECLARATION.viewports, { name: "phone", width: 320, height: 640 }],
    states: [{ name: "default" }, { name: "default", textPx: 32 }],
    targets: [
      { name: "headline", selector: "h1", routes: ["/about/"] },
      { name: "headline", selector: "main h1" },
    ],
    checks: ["layout", "keyboard", "motion", "layout"],
  };
  expect(inconsistencies(contradicting)).toEqual([
    "route / is declared twice",
    "viewport phone is declared twice",
    "state default is declared twice",
    "target headline is declared twice",
    "check layout is declared twice",
    "target headline names route /about/, which no route declares",
    "check motion judges a visitor who turns motion off, and no state sets reducedMotion to reduce",
    "check keyboard judges the targets Tab reaches, and no target sets focusable",
  ]);
});

const [VISIT] = visitsOf(DECLARATION);

function outcome(found: readonly string[], unverified: readonly string[] = []): Outcome {
  if (VISIT === undefined) throw new Error("the declaration yields no visit");
  return {
    runs: [{ check: "layout", visit: VISIT, inventory: counted(["language switch", "language switch"]), found, unverified }],
    missingRoutes: [],
  };
}

test("a clean run records what it scanned and passes", () => {
  expect(passes(outcome([]))).toBe(true);
  expect(report(DECLARATION, outcome([]))).toBe(
    [
      "browser: layout at / (en), phone 375x812 touch, default scanned language switch 2",
      "browser: 1 check run(s) over 2 route(s), 1 viewport(s), 2 state(s) and 2 target(s) pass",
    ].join("\n"),
  );
});

test("a failure names its check and visit, unverified contrast is listed without failing, and a missing route or an empty run fails", () => {
  const failing = outcome(["language switch clips its own text"], ["color-contrast unverified: p"]);
  expect(passes(failing)).toBe(false);
  expect(report(DECLARATION, failing).split("\n").slice(1)).toEqual([
    "browser: 1 contrast check(s) axe cannot measure, reported as unverified:",
    "  layout at / (en), phone 375x812 touch, default: color-contrast unverified: p",
    "browser: 1 failure(s) in 1 check run(s) over 2 route(s), 1 viewport(s), 2 state(s) and 2 target(s):",
    "  layout at / (en), phone 375x812 touch, default: language switch clips its own text",
  ]);
  expect(passes(outcome([], ["color-contrast unverified: p"]))).toBe(true);
  const empty: Outcome = { runs: [], missingRoutes: ["/ru/"] };
  expect(passes(empty)).toBe(false);
  expect(report(DECLARATION, empty)).toBe(
    [
      "browser: 2 failure(s) in 0 check run(s) over 2 route(s), 1 viewport(s), 2 state(s) and 2 target(s):",
      "  route /ru/ serves no page from the declared site",
      "  the declaration leaves no check to run",
    ].join("\n"),
  );
});
