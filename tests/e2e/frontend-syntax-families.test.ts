import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CHECKOUT, fixtureRepos } from "./lib/fixture-repo.ts";

const open = fixtureRepos("checks-frontend-syntax-families-");

const GATE = "quality/frontend-syntax.ts";

const BUILDER = join(CHECKOUT, "src", "quality", "presets", "stylelint.ts");

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

test("the design token rules stay off without token globs, and hold nothing in a declared token file", async () => {
  const { write, script } = await repository(WIDELY, { "src/site.css": "a { color: #000; font-size: 12px; }\n" });
  expect((await script(GATE)).exitCode).toBe(1);
  await write({ "src/site.css": "a {\n  color: #000;\n  font-size: 12px;\n}\n" });
  expect(await script(GATE)).toEqual({ exitCode: 0, text: "frontend-syntax: no violation in 1 file(s) from 1 declared input(s)\n" });

  await write({ "stylelint.config.ts": stylelintConfig('{ baseline: "widely", tokens: ["src/site.css"] }') });
  expect(await script(GATE)).toEqual({ exitCode: 0, text: "frontend-syntax: no violation in 1 file(s) from 1 declared input(s)\n" });
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
