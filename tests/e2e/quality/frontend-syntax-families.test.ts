import { expect, test } from "bun:test";
import { join } from "node:path";
import { CHECKOUT, fixtureRepos } from "../lib/fixture-repo.ts";
import { settingsFile } from "../lib/settings-file.ts";

const open = fixtureRepos("checks-frontend-syntax-families-");

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
    family: "G4 design tokens, a literal size in the font shorthand",
    options: '{ baseline: "widely", tokens: ["src/tokens.css"] }',
    red: "p { font: 12px serif; }\n",
    green: "p { font: small-caps var(--text-small)/var(--leading) \"Roboto Medium\", serif; }\n",
    reported: "src/site.css:1:11 Disallowed value \"12px serif\" for property \"font\" (declaration-property-value-allowed-list)",
  },
  {
    family: "G4 design tokens, a size smuggled through a local custom property",
    options: '{ baseline: "widely", tokens: ["src/tokens.css"] }',
    red: "p { font-size: var(--size); }\n:root { --size: 12px; }\n",
    green: ".card { gap: var(--gap); }\n:root { --gap: 12px; }\n",
    reported: "src/site.css:1:20 Expected \"--size\" from the token files rather than set in this file (checks/font-size-from-tokens)",
  },
  {
    family: "G4 design tokens, a local custom property size inside the font shorthand",
    options: '{ baseline: "widely", tokens: ["src/tokens.css"] }',
    red: "p { font: var(--size) serif; }\n:root { --size: 12px; }\n",
    green: ".card { --card-text: var(--text-small); }\n.card p { font: var(--card-text) serif; }\n",
    reported: "(checks/font-size-from-tokens)",
  },
  {
    family: "G4 design tokens, a literal size after a token weight in the font shorthand",
    options: '{ baseline: "widely", tokens: ["src/tokens.css"] }',
    red: "p { font: var(--weight) 12px serif; }\n",
    green: "p { font: var(--text-s) serif; }\n",
    reported: "(declaration-property-value-allowed-list)",
  },
  {
    family: "G4 design tokens, a local size and family after a token weight in the font shorthand",
    options: '{ baseline: "widely", tokens: ["src/tokens.css"] }',
    red: "p { font: var(--weight) var(--rest); }\n:root { --rest: 12px serif; }\n",
    green: ".code { font: var(--text-s) var(--mono); }\n:root { --mono: ui-monospace, monospace; }\n",
    reported: "src/site.css:1:29 Expected \"--rest\" from the token files rather than set in this file (checks/font-size-from-tokens)",
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
