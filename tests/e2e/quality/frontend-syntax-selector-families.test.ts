import { expect, test } from "bun:test";
import { join } from "node:path";
import { CHECKOUT, fixtureRepos } from "../lib/fixture-repo.ts";
import { settingsFile } from "../lib/settings-file.ts";

const open = fixtureRepos("checks-frontend-syntax-selector-families-");

const GATE = "quality/frontend-syntax.ts";

const BUILDER = join(CHECKOUT, "dist", "presets", "stylelint.js");

function stylelintConfig(options: string): string {
  return `import { defineConfig } from ${JSON.stringify(BUILDER)};\n\nexport default defineConfig(${options});\n`;
}

function repository(options: string, files: Readonly<Record<string, string>>) {
  return open({
    "checks.config.ts": settingsFile({ frontendSyntax: { inputs: ["src/**/*.css"] } }),
    "stylelint.config.ts": stylelintConfig(options),
    ...files,
  });
}

const WIDELY = '{ baseline: "widely", tokens: false }';

const FAMILIES = [
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
    family: "G10 page-wide :has(), judged per selector of a list so a component :has() beside :root passes",
    options: '{ baseline: "widely", tokens: false, noPageHas: true }',
    red: ":root:has(.hero), .card { top: 0; }\n",
    green: ":root, .card:has(.icon) { top: 0; }\n",
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

test("flatSelectors refuses native nesting, so a nested chain cannot pass three compounds or a page :has() past noPageHas", async () => {
  const options = '{ baseline: "newly", tokens: false, bem: true, flatSelectors: true, noPageHas: true }';
  const { write, script } = await repository(options, { "src/site.css": ".page .hero__name { top: 0; }\n" });
  expect(await script(GATE)).toEqual({ exitCode: 0, text: "frontend-syntax: no violation in 1 file(s) from 1 declared input(s)\n" });

  for (const nested of [".page { .hero { .hero__name { top: 0; } } }\n", ":root { &:has(.hero) { top: 0; } }\n"]) {
    await write({ "src/site.css": nested });
    const red = await script(GATE);
    expect(red.text, nested).toContain("(max-nesting-depth)");
    expect(red.exitCode, nested).toBe(1);
  }
}, 60_000);

test("noPageHas refuses a :has() whose compound holds no class, since its subject can be the root element", async () => {
  const options = '{ baseline: "widely", tokens: false, bem: true, flatSelectors: true, noPageHas: true }';
  const { write, script } = await repository(options, { "src/site.css": ".card:has(.card__icon) .menu__toggle, .card:not(:has(.card__icon)) { top: 0; }\n" });
  expect(await script(GATE)).toEqual({ exitCode: 0, text: "frontend-syntax: no violation in 1 file(s) from 1 declared input(s)\n" });

  for (const page of [":has(.hero)", ":scope:has(.hero)", ":not(.card):has(.hero)", ":is(:has(.hero))"]) {
    const selector = `${page} .menu__toggle`;
    await write({ "src/site.css": `${selector} { top: 0; }\n` });
    expect(await script(GATE), selector).toEqual({
      exitCode: 1,
      text: `frontend-syntax: 1 problem(s) in 1 file(s) from 1 declared input(s):\n  src/site.css:1:1 Disallowed selector "${selector}" (selector-disallowed-list)\n`,
    });
  }
}, 60_000);

test("all three options fail one website menu rule on four families, and pass its marker-class rewrite", async () => {
  const options = '{ baseline: "widely", tokens: false, bem: true, flatSelectors: true, noPageHas: true }';
  const { write, script } = await repository(options, { "src/site.css": ".page--past-hero .menu__toggle { top: 0; }\n" });
  expect(await script(GATE)).toEqual({ exitCode: 0, text: "frontend-syntax: no violation in 1 file(s) from 1 declared input(s)\n" });

  await write({ "src/site.css": "html:has(.hero) .menu-toggle:not([data-past-hero]) { top: 0; }\n" });
  const red = await script(GATE);
  for (const name of ["selector-class-pattern", "selector-max-type", "selector-max-attribute", "selector-disallowed-list"]) {
    expect(red.text).toContain(`(${name})`);
  }
  expect(red.exitCode).toBe(1);
}, 60_000);
