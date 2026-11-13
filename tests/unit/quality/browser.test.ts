import { expect, test } from "bun:test";
import { describeVisit, expanded as expandedOn, inconsistencies, runsIn, targetsOn, visitsOf, type Declaration, type Listed, type State } from "../../../src/quality/browser/declaration.ts";
import { counted, passes, report, type Outcome } from "../../../src/quality/browser/report.ts";

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

const BUILT = ["/", "/about/", "/notes.html", "/ru/"] as const;

const expanded = (listed: Listed): Declaration => expandedOn(listed, BUILT);

test("the every-page preset expands to each built page under its locale, leaving none unvisited and none twice", () => {
  const { routes } = expanded({ ...DECLARATION, routes: [{ preset: "every-page", locale: "en" }] });
  expect([...routes]).toEqual(BUILT.map((path) => ({ path, locale: "en" })));
  expect(inconsistencies(expanded({ ...DECLARATION, routes: [{ preset: "every-page", locale: "en" }] }))).toEqual([]);
});

test("a route the every-page preset also finds, or the preset listed twice, is refused as declared twice rather than visited twice", () => {
  const beside = expanded({ ...DECLARATION, routes: [{ preset: "every-page", locale: "en" }, { path: "/ru/", locale: "ru" }] });
  expect(inconsistencies(beside)).toEqual(["route /ru/ is declared twice"]);
  const twice = expanded({ ...DECLARATION, routes: [{ preset: "every-page", locale: "en" }, { preset: "every-page", locale: "ru" }] });
  expect(inconsistencies(twice)).toEqual(BUILT.map((path) => `route ${path} is declared twice`));
});

test("a state that names its checks runs only those, so an axe-only default motion state skips layout and motion", () => {
  const reduced: State = { name: "reduced motion", reducedMotion: "reduce" };
  const moving: State = { name: "default motion", checks: ["axe"] };
  const states: Declaration["states"] = [reduced, moving];
  const checks = ["layout", "motion", "axe"] as const;
  expect(checks.map((check) => runsIn(reduced, check))).toEqual([true, true, true]);
  expect(checks.map((check) => runsIn(moving, check))).toEqual([false, false, true]);
  expect(inconsistencies({ ...DECLARATION, states, checks: ["layout", "keyboard", "motion", "axe"] })).toEqual([]);
});

test("a state that names an undeclared check, a check twice or motion without reduced motion, and a check no state runs, are refused rather than skipped", () => {
  const contradicting: Declaration = {
    ...DECLARATION,
    states: [
      { name: "default", checks: ["axe", "axe", "html"] },
      { name: "moving", checks: ["motion"] },
      { name: "reduced motion", reducedMotion: "reduce", checks: ["axe"] },
    ],
    checks: ["layout", "motion", "axe"],
  };
  expect(inconsistencies(contradicting)).toEqual([
    "state default names check axe twice",
    "state default names check html, which checks does not declare",
    "state moving names check motion, which runs only in a state whose reducedMotion is reduce",
    "check layout runs in no state, since each state names its checks without it",
    "check motion judges a visitor who turns motion off, and no state that runs it sets reducedMotion to reduce",
  ]);
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
    checks: ["layout", "keyboard", "motion", "contrast", "layout"],
  };
  expect(inconsistencies(contradicting)).toEqual([
    "route / is declared twice",
    "viewport phone is declared twice",
    "state default is declared twice",
    "target headline is declared twice",
    "check layout is declared twice",
    "target headline names route /about/, which no route declares",
    "check motion judges a visitor who turns motion off, and no state that runs it sets reducedMotion to reduce",
    "check keyboard judges the targets Tab reaches, and no target sets focusable",
    "check contrast measures the text over a photo or a gradient, and no target sets contrast",
  ]);
});

test("a declaration that budgets weight and bounds shift has no inconsistency", () => {
  expect(
    inconsistencies({
      ...DECLARATION,
      checks: [...DECLARATION.checks, "weight", "shift"],
      weight: { nonImageBytes: 700_000, scriptBytes: 450_000, imageBytes: 500_000 },
      shift: { max: 0.1 },
    }),
  ).toEqual([]);
});

test("a weight check with no budgets and a shift check with no bound are refused, not run unbounded", () => {
  expect(inconsistencies({ ...DECLARATION, checks: [...DECLARATION.checks, "weight", "shift"] })).toEqual([
    "check weight judges the bytes each page transfers, and no budgets declare them",
    "check shift judges the movement of a cold load, and no bound declares it",
  ]);
});

const ANCHOR_SIZES = ["phone 360x640", "phone 375x667", "phone 393x852", "phone 412x915", "tablet 820x1180", "desktop 1366x768", "desktop 1440x900", "desktop 1920x1080"];

const NIGHTLY_SIZES = [
  ...["phone 320x568", "phone 360x540", "phone 375x567", "phone 375x812", "phone 390x844", "phone 430x932"],
  ...["tablet 768x1024", "tablet 1024x1366", "desktop 1280x800", "desktop 1536x864", "desktop 2560x1440"],
];

function listing(viewports: Listed["viewports"], states: Listed["states"] = DECLARATION.states): Listed {
  return { ...DECLARATION, viewports, states };
}

function sizesOf({ viewports }: Declaration): readonly string[] {
  return viewports.map(({ device, width, height }) => `${device ?? "unclassed"} ${width}x${height}`).toSorted();
}

test("the anchor preset expands to exactly the eight anchor sizes, with none missing, none extra and none in the wrong device class", () => {
  expect(sizesOf(expanded(listing([{ preset: "anchor" }])))).toEqual(ANCHOR_SIZES.toSorted());
});

test("the full preset expands to the anchors and the eleven nightly sizes, with none missing and none extra", () => {
  expect(sizesOf(expanded(listing([{ preset: "full" }])))).toEqual([...ANCHOR_SIZES, ...NIGHTLY_SIZES].toSorted());
});

test("every phone a preset expands to has touch and no tablet or desktop does, so a phone is never judged without a mobile viewport", () => {
  const { viewports } = expanded(listing([{ preset: "full" }]));
  const touching = viewports.filter(({ touch }) => touch === true).map(({ width, height }) => `phone ${width}x${height}`);
  expect(touching.toSorted()).toEqual([...ANCHOR_SIZES, ...NIGHTLY_SIZES].filter((size) => size.startsWith("phone ")).toSorted());
});

test("a preset gives each entry a name of its own, so the full set never collides with itself", () => {
  expect(inconsistencies(expanded(listing([{ preset: "full" }])))).toEqual([]);
});

test("a preset sits beside a product's own viewport, which keeps its fields as listed", () => {
  const { viewports } = expanded(listing([{ preset: "anchor" }, { name: "kiosk", width: 1080, height: 1920, touch: true }]));
  expect(viewports).toHaveLength(9);
  expect(viewports.at(-1)).toEqual({ name: "kiosk", width: 1080, height: 1920, touch: true });
});

test("a listed viewport that reuses a preset entry's name, or a preset listed twice, is refused as declared twice", () => {
  const reused = expanded(listing([{ preset: "anchor" }, { name: "phone-375x667", width: 375, height: 667 }]));
  expect(inconsistencies(reused)).toEqual(["viewport phone-375x667 is declared twice"]);
  const twice = inconsistencies(expanded(listing([{ preset: "anchor" }, { preset: "full" }])));
  expect(twice).toHaveLength(ANCHOR_SIZES.length);
  expect(twice).toContain("viewport desktop-1920x1080 is declared twice");
});

test("the enlarged text preset sets the default text to 32px, not the browser's 16px, and is refused beside a state of its name", () => {
  const { states } = expanded(listing([{ preset: "anchor" }], [...DECLARATION.states, { preset: "enlarged-text" }]));
  expect(states.at(-1)).toEqual({ name: "enlarged text", textPx: 32 });
  const twice = expanded(listing([{ preset: "anchor" }], [...DECLARATION.states, { name: "enlarged text", textPx: 24 }, { preset: "enlarged-text" }]));
  expect(inconsistencies(twice)).toEqual(["state enlarged text is declared twice"]);
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
