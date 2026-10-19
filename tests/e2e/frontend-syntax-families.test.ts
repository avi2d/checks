import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CHECKOUT, fixtureRepos } from "./lib/fixture-repo.ts";

const open = fixtureRepos("checks-frontend-syntax-families-");

const GATE = "quality/frontend-syntax.ts";

const BUILDER = join(CHECKOUT, "dist", "presets", "stylelint.js");

function stylelintConfig(options: string): string {
  return `import { defineConfig } from ${JSON.stringify(BUILDER)};\n\nexport default defineConfig(${options});\n`;
}

function repository(options: string, files: Readonly<Record<string, string>>) {
  return open({
    "frontend-syntax.json": JSON.stringify({ inputs: ["src/**/*.css"] }),
    "stylelint.config.ts": stylelintConfig(options),
    ...files,
  });
}

const WIDELY = '{ baseline: "widely", tokens: false }';

const FAMILIES = [
  {
    family: "G1 correctness, a value its property does not take",
    options: WIDELY,
    red: "a { top: red; }\n",
    green: "a { top: 0; }\n",
    reported: "src/site.css:1:10 Unknown value \"red\" for property \"top\" (declaration-property-value-no-unknown)",
  },
  {
    family: "G1 correctness, the oldstyle-num typo of the oldstyle-nums keyword",
    options: WIDELY,
    red: "p { font-variant-numeric: oldstyle-num; }\n",
    green: "p { font-variant-numeric: oldstyle-nums; }\n",
    reported: "(declaration-property-value-no-unknown)",
  },
  {
    family: "G2 conventions, a long hex colour",
    options: WIDELY,
    red: "a { color: #ffffff; }\n",
    green: "a { color: #fff; }\n",
    reported: "src/site.css:1:12 Expected \"#ffffff\" to be \"#fff\" (color-hex-length)",
  },
  {
    family: "G3 selector complexity, four compound selectors",
    options: WIDELY,
    red: "nav ul li a { top: 0; }\n",
    green: "nav li a { top: 0; }\n",
    reported: "src/site.css:1:1 Too many compound selectors in \"nav ul li a\", maximum 3 (selector-max-compound-selectors)",
  },
  {
    family: "G3 selector complexity, specificity 0,4,0",
    options: WIDELY,
    red: ".a.b.c.d { top: 0; }\n",
    green: ".a.b.c { top: 0; }\n",
    reported: "src/site.css:1:1 Too high specificity in \".a.b.c.d\", maximum \"0,3,2\" (selector-max-specificity)",
  },
  {
    family: "G4 design tokens, a hex colour outside the token files",
    options: '{ baseline: "widely", tokens: ["src/tokens.css"] }',
    red: "a { color: #000; }\n",
    green: "a { color: var(--ink); }\n",
    reported: "src/site.css:1:12 Disallowed hex color \"#000\" (color-no-hex)",
  },
  {
    family: "G4 design tokens, a literal font size",
    options: '{ baseline: "widely", tokens: ["src/tokens.css"] }',
    red: "p { font-size: 12px; }\n",
    green: "p { font-size: var(--text-s); }\n",
    reported: "src/site.css:1:16 Disallowed value \"12px\" for property \"font-size\" (declaration-property-value-allowed-list)",
  },
  {
    family: "G4 design tokens, a literal font size under a property name in capitals",
    options: '{ baseline: "widely", tokens: ["src/tokens.css"] }',
    red: "p { FONT-SIZE: 12px; }\n",
    green: "p { font-size: inherit; }\n",
    reported: "src/site.css:1:16 Disallowed value \"12px\" for property \"FONT-SIZE\" (declaration-property-value-allowed-list)",
  },
  {
    family: "G4 design tokens, a literal font size added to a token",
    options: '{ baseline: "widely", tokens: ["src/tokens.css"] }',
    red: "p { font-size: calc(var(--text-s) + 12px); }\n",
    green: "p { font-size: var(--text-s); }\n",
    reported: "(declaration-property-value-allowed-list)",
  },
  {
    family: "G6 comments refused, a real comment from the website stylesheet",
    options: WIDELY,
    red: "/* 100vw counts a classic scrollbar, so a name measures the content box of its band: use this only inside the hero, an inline-size container. */\na { top: 0; }\n",
    green: "a { top: 0; }\n",
    reported: "Disallowed word matching pattern \"/^[\\s\\S]*$/\" (comment-word-disallowed-list)",
  },
  {
    family: "G6 comments refused, an empty comment with the shared empty-comment rule off",
    options: '{ baseline: "widely", tokens: false, rules: { "comment-no-empty": null } }',
    red: "/* */\na { top: 0; }\n",
    green: "a { top: 0; }\n",
    reported: "(comment-word-disallowed-list)",
  },
  {
    family: "G7 language-free selectors, a Cyrillic attribute value from the website stylesheet",
    options: WIDELY,
    red: ".block[data-section=\"обо-\u043c\u043d\u0435\"] { top: 0; }\n",
    green: ".block[data-section=\"about\"] { top: 0; }\n",
    reported: "Disallowed selector \".block[data-section=\"обо-\u043c\u043d\u0435\"]\" (selector-disallowed-list)",
  },
  {
    family: "G7 language-free selectors, a Cyrillic class name with the shared kebab-case rule off",
    options: '{ baseline: "widely", tokens: false, rules: { "selector-class-pattern": null } }',
    red: ".\u043c\u0435\u043d\u044e { top: 0; }\n",
    green: ".menu { top: 0; }\n",
    reported: "(selector-disallowed-list)",
  },
  {
    family: "G7 language-free selectors, the C1 control character U+0085 in an attribute value",
    options: WIDELY,
    red: ".block[data-section=\"a\u0085b\"] { top: 0; }\n",
    green: ".block[data-section=\"ab\"] { top: 0; }\n",
    reported: "(selector-disallowed-list)",
  },
  {
    family: "G5 Baseline, scrollbar-gutter, newly available in 2024, against a widely available target",
    options: WIDELY,
    red: "html { scrollbar-gutter: stable; }\n",
    green: "html { overflow-y: scroll; }\n",
    reported: "src/site.css:1:8 Property \"scrollbar-gutter\" is not a widely available baseline feature. (plugin/use-baseline)",
  },
  {
    family: "G5 Baseline, scrollbar-gutter against a 2023 target",
    options: '{ baseline: 2023, tokens: false }',
    red: "html { scrollbar-gutter: stable; }\n",
    green: "html { overflow-y: scroll; }\n",
    reported: "(plugin/use-baseline)",
  },
  {
    family: "G5 Baseline, user-select, which no Baseline year holds, against a newly available target",
    options: '{ baseline: "newly", tokens: false }',
    red: ".handle { user-select: none; }\n",
    green: ".handle { cursor: grab; }\n",
    reported: "src/site.css:1:11 Property \"user-select\" is not a newly available baseline feature. (plugin/use-baseline)",
  },
  {
    family: "G8 BEM names, the joined element name the website stylesheet writes",
    options: '{ baseline: "widely", tokens: false, bem: true }',
    red: ".hero-name { top: 0; }\n",
    green: ".hero__name { top: 0; }\n",
    reported: "(selector-class-pattern)",
  },
  {
    family: "G9 class-only selectors, the heading type selector the website stylesheet writes",
    options: '{ baseline: "widely", tokens: false, flatSelectors: true }',
    red: ".hero h1 { grid-area: title; }\n",
    green: ".hero-title { grid-area: title; }\n",
    reported: "(selector-max-type)",
  },
  {
    family: "G9 class-only selectors, the section attribute selector the website stylesheet writes",
    options: '{ baseline: "widely", tokens: false, flatSelectors: true }',
    red: ".block[data-section=\"about\"] { top: 0; }\n",
    green: ".block-about { top: 0; }\n",
    reported: "(selector-max-attribute)",
  },
  {
    family: "G9 class-only selectors, a positional pseudo-class on a class",
    options: '{ baseline: "widely", tokens: false, flatSelectors: true }',
    red: ".hero-name:first-child { top: 0; }\n",
    green: ".hero-name-first { top: 0; }\n",
    reported: "Disallowed pseudo-class \":first-child\" (selector-pseudo-class-disallowed-list)",
  },
  {
    family: "G9 class-only selectors, the universal selector",
    options: '{ baseline: "widely", tokens: false, flatSelectors: true }',
    red: "* { top: 0; }\n",
    green: ".hero { top: 0; }\n",
    reported: "src/site.css:1:1 Too many universal selectors in \"*\", maximum 0 (selector-max-universal)",
  },
  {
    family: "G10 page-wide :has(), the contacts rule the website stylesheet writes",
    options: '{ baseline: "widely", tokens: false, noPageHas: true }',
    red: "main:has(> .block[data-section=\"contacts\"]:last-of-type) + footer { top: 0; }\n",
    green: ".contact-end .site-footer { top: 0; }\n",
    reported: "(selector-disallowed-list)",
  },
  {
    family: "G10 page-wide :has(), the root pseudo-class in place of html",
    options: '{ baseline: "widely", tokens: false, noPageHas: true }',
    red: ":root:has(.hero) { top: 0; }\n",
    green: ".page-hero { top: 0; }\n",
    reported: "src/site.css:1:1 Disallowed selector \":root:has(.hero)\" (selector-disallowed-list)",
  },
  {
    family: "G10 page-wide :has(), html with its :has() broken across lines",
    options: '{ baseline: "widely", tokens: false, noPageHas: true }',
    red: "html:has(\n  .hero\n) {\n  top: 0;\n}\n",
    green: ".page-hero {\n  top: 0;\n}\n",
    reported: "(selector-disallowed-list)",
  },
] as const;

for (const { family, options, red, green, reported } of FAMILIES) {
  test(`red on ${family}, and green once it is fixed`, async () => {
    const { write, script } = await repository(options, { "src/site.css": green, "src/tokens.css": ":root {\n  --ink: #000;\n  --text-s: 0.875rem;\n}\n" });
    const passing = await script(GATE);
    expect(passing.text).toBe("frontend-syntax: no violation in 2 file(s) from 1 declared input(s)\n");
    expect(passing.exitCode).toBe(0);

    await write({ "src/site.css": red });
    const failing = await script(GATE);
    expect(failing.text).toStartWith("frontend-syntax: 1 problem(s) in 2 file(s) from 1 declared input(s):\n  src/site.css:1:");
    expect(failing.text).toContain(reported);
    expect(failing.exitCode).toBe(1);
  }, 60_000);
}

test("flatSelectors fails a website rule on its compound selectors beside its type selectors, and passes its one-class rewrite", async () => {
  const { write, script } = await repository('{ baseline: "widely", tokens: false, flatSelectors: true }', { "src/site.css": ".block-item { top: 0; }\n" });
  expect(await script(GATE)).toEqual({ exitCode: 0, text: "frontend-syntax: no violation in 1 file(s) from 1 declared input(s)\n" });

  await write({ "src/site.css": ".block-body > ul:not(:has(a)) > li { top: 0; }\n" });
  const red = await script(GATE);
  expect(red.text).toContain("(selector-max-compound-selectors)");
  expect(red.text).toContain("(selector-max-type)");
  expect(red.exitCode).toBe(1);
}, 60_000);

test("all three options fail one website menu rule on four families, and pass its marker-class rewrite", async () => {
  const options = '{ baseline: "widely", tokens: false, bem: true, flatSelectors: true, noPageHas: true }';
  const { write, script } = await repository(options, { "src/site.css": ".page--past-hero .menu__toggle { top: 0; }\n" });
  expect(await script(GATE)).toEqual({ exitCode: 0, text: "frontend-syntax: no violation in 1 file(s) from 1 declared input(s)\n" });

  await write({ "src/site.css": "html:has(.hero) .menu-toggle:not([data-past-hero]) { top: 0; }\n" });
  const red = await script(GATE);
  for (const rule of ["selector-class-pattern", "selector-max-type", "selector-max-attribute", "selector-disallowed-list"]) {
    expect(red.text).toContain(`(${rule})`);
  }
  expect(red.exitCode).toBe(1);
}, 60_000);

test("the design token rules stay off without token globs, and hold nothing in a declared token file", async () => {
  const { write, script } = await repository(WIDELY, { "src/site.css": "a { color: #000; font-size: 12px; }\n" });
  expect((await script(GATE)).exitCode).toBe(1);
  await write({ "src/site.css": "a {\n  color: #000;\n  font-size: 12px;\n}\n" });
  expect(await script(GATE)).toEqual({ exitCode: 0, text: "frontend-syntax: no violation in 1 file(s) from 1 declared input(s)\n" });

  await write({ "stylelint.config.ts": stylelintConfig('{ baseline: "widely", tokens: ["src/site.css"] }') });
  expect(await script(GATE)).toEqual({ exitCode: 0, text: "frontend-syntax: no violation in 1 file(s) from 1 declared input(s)\n" });
}, 60_000);

test("an @property rule passes the widely target, since a browser without it keeps the unregistered custom property", async () => {
  const { script } = await repository(WIDELY, { "src/site.css": "@property --brand { syntax: \"<color>\"; inherits: false; initial-value: red; }\n" });
  expect(await script(GATE)).toEqual({ exitCode: 0, text: "frontend-syntax: no violation in 1 file(s) from 1 declared input(s)\n" });
}, 60_000);

test("an @property rule still passes when the repository sets its own Baseline rule for an exception", async () => {
  const options = '{ baseline: "widely", tokens: false, rules: { "plugin/use-baseline": [true, { available: "widely", ignoreProperties: { "user-select": ["none"] } }] } }';
  const { script } = await repository(options, { "src/site.css": "@property --brand { syntax: \"<color>\"; inherits: false; initial-value: red; }\na { user-select: none; }\n" });
  expect(await script(GATE)).toEqual({ exitCode: 0, text: "frontend-syntax: no violation in 1 file(s) from 1 declared input(s)\n" });
}, 60_000);

test("an @view-transition rule still fails the widely target, so the @property pass stays narrow", async () => {
  const { write, script } = await repository(WIDELY, { "src/site.css": "a { top: 0; }\n" });
  expect(await script(GATE)).toEqual({ exitCode: 0, text: "frontend-syntax: no violation in 1 file(s) from 1 declared input(s)\n" });

  await write({ "src/site.css": "@view-transition { navigation: auto; }\n" });
  const failing = await script(GATE);
  expect(failing.text).toContain('At-rule "@view-transition" is not a widely available baseline feature. (plugin/use-baseline)');
  expect(failing.exitCode).toBe(1);
}, 60_000);

test("a scrollbar-gutter newly available in 2024 passes a 2024 target and a newly available one", async () => {
  for (const baseline of ["2024", '"newly"']) {
    const { script } = await repository(`{ baseline: ${baseline}, tokens: false }`, { "src/site.css": "html { scrollbar-gutter: stable; }\n" });
    expect(await script(GATE), baseline).toEqual({ exitCode: 0, text: "frontend-syntax: no violation in 1 file(s) from 1 declared input(s)\n" });
  }
}, 60_000);

test("--fix rewrites what a convention fixes, and leaves the rest reported", async () => {
  const { dir, script } = await repository(WIDELY, { "src/site.css": "a { color: #ffffff; }\n.a.b.c.d { top: 0; }\n" });
  const fixed = await script(GATE, "--fix");
  expect(await readFile(join(dir, "src", "site.css"), "utf8")).toBe("a { color: #fff; }\n.a.b.c.d { top: 0; }\n");
  expect(fixed.text).toBe(
    'frontend-syntax: 1 problem(s) in 1 file(s) from 1 declared input(s):\n  src/site.css:2:1 Too high specificity in ".a.b.c.d", maximum "0,3,2" (selector-max-specificity)\n',
  );
  expect(fixed.exitCode).toBe(1);
}, 60_000);

test("a stylelint-disable comment silences nothing, the kit's own rules included", async () => {
  const { script } = await repository(WIDELY, {
    "src/site.css": "/* stylelint-disable */\n.a.b.c.d { top: 0; }\n\na { transition: all 1s; }\n",
  });
  const red = await script(GATE);
  expect(red.text).toContain("src/site.css:2:1 Too high specificity");
  expect(red.text).toContain('src/site.css:4:17 Disallowed value "all 1s" for property "transition". Name the properties the transition animates.');
  expect(red.exitCode).toBe(1);
}, 60_000);

test("--suppress counts what the config reports into stylelint-suppressions.json, which then lets only those counts through", async () => {
  const { dir, write, script } = await repository(WIDELY, { "src/site.css": ".a.b.c.d { top: 0; }\n\na { transition: all 1s; }\n" });
  const suppressed = await script(GATE, "--suppress");
  expect(JSON.parse(await readFile(join(dir, "stylelint-suppressions.json"), "utf8"))).toEqual({
    "src/site.css": { "selector-max-specificity": { count: 1 } },
  });
  expect(suppressed.text).toContain('src/site.css:3:17 Disallowed value "all 1s" for property "transition"');
  expect(suppressed.text).not.toContain("selector-max-specificity");
  expect(suppressed.exitCode).toBe(1);

  await write({ "src/site.css": ".a.b.c.d { top: 0; }\n\n.e.f.g.h { top: 0; }\n" });
  const grown = await script(GATE);
  expect(grown.text).toContain("src/site.css:1:1 Too high specificity");
  expect(grown.text).toContain("src/site.css:3:1 Too high specificity");
  expect(grown.exitCode).toBe(1);

  await write({ "src/site.css": ".a.b.c.d { top: 0; }\n" });
  expect(await script(GATE)).toEqual({ exitCode: 0, text: expect.stringContaining("frontend-syntax: no violation in 1 file(s) from 1 declared input(s)\n") });
}, 60_000);

test("a count in stylelint-suppressions.json under a kit rule's name lets no kit violation through", async () => {
  const { write, script } = await repository('{ baseline: "widely", tokens: false, rules: { "declaration-property-value-disallowed-list": { display: ["block"] } } }', {
    "src/site.css": "a { display: block; }\n",
  });
  expect((await script(GATE, "--suppress")).exitCode).toBe(0);

  await write({ "src/site.css": "a { display: block; }\n\nb { transition: all 1s; }\n" });
  const red = await script(GATE);
  expect(red.text).toContain('src/site.css:3:17 Disallowed value "all 1s" for property "transition". Name the properties the transition animates.');
  expect(red.exitCode).toBe(1);
}, 60_000);

test("--suppress lets no file through that does not parse", async () => {
  const { script } = await repository(WIDELY, { "src/site.css": "a { top: 0;\n" });
  for (const flags of [["--suppress"], []]) {
    const red = await script(GATE, ...flags);
    expect(red.text, flags.join(" ")).toContain("src/site.css:1:1 Unclosed block");
    expect(red.exitCode, flags.join(" ")).toBe(1);
  }
}, 60_000);

test("a colour function in capitals fails the design token rules once tokens are set, whatever the convention count suppresses", async () => {
  const { write, script } = await repository(WIDELY, { "src/site.css": "a { color: RGB(0 0 0); }\n", "src/tokens.css": ":root {\n  --ink: #000;\n}\n" });
  expect((await script(GATE, "--suppress")).exitCode).toBe(0);

  await write({ "stylelint.config.ts": stylelintConfig('{ baseline: "widely", tokens: ["src/tokens.css"] }') });
  const red = await script(GATE);
  expect(red.text).toContain('src/site.css:1:12 Disallowed function "RGB" (function-disallowed-list)');
  expect(red.exitCode).toBe(1);
}, 60_000);

test("a selector that does not parse fails, whatever bulk suppression counts", async () => {
  const { script } = await repository(WIDELY, { "src/site.css": "a] { top: 0; }\n" });
  for (const flags of [["--suppress"], []]) {
    const red = await script(GATE, ...flags);
    expect(red.text, flags.join(" ")).toContain("src/site.css:1:1 Cannot parse selector");
    expect(red.exitCode, flags.join(" ")).toBe(1);
  }
}, 60_000);

test("a file the config ignores is counted among the files the kit's rules judged", async () => {
  const { write, script } = await repository('{ baseline: "widely", tokens: false, ignoreFiles: ["src/vendor.css"] }', { "src/vendor.css": "a { top: 0; }\n" });
  expect(await script(GATE)).toEqual({ exitCode: 0, text: "frontend-syntax: no violation in 1 file(s) from 1 declared input(s)\n" });

  await write({ "src/site.css": "a { top: 0; }\n" });
  expect(await script(GATE)).toEqual({ exitCode: 0, text: "frontend-syntax: no violation in 2 file(s) from 1 declared input(s)\n" });
}, 60_000);

test("a declaration without stylelint.config.ts, a config that does not load, and an unknown flag are refused", async () => {
  const { dir, write, script } = await repository(WIDELY, { "src/site.css": "a { top: 0; }\n" });
  await Bun.$`rm stylelint.config.ts`.cwd(dir).quiet();
  const missing = await script(GATE);
  expect(missing.text).toContain("frontend-syntax: stylelint.config.ts is missing, and a repository that declares frontend-syntax.json writes it with defineConfig from @avi2dg/checks/stylelint");
  expect(missing.exitCode).toBe(2);

  await write({ "stylelint.config.ts": stylelintConfig('{ baseline: "someday", tokens: false }') });
  const refused = await script(GATE);
  expect(refused.text).toContain('@avi2dg/checks/stylelint: set baseline to "widely", "newly" or a year such as 2024');
  expect(refused.exitCode).toBe(2);

  await write({ "stylelint.config.ts": stylelintConfig(WIDELY) });
  const flagged = await script(GATE, "--fiks");
  expect(flagged.text).toContain("frontend-syntax: usage: frontend-syntax.ts [--fix] [--suppress] [<directory>]");
  expect(flagged.exitCode).toBe(2);
}, 60_000);
