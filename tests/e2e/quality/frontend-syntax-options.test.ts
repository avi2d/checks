import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CHECKOUT, fixtureRepos } from "../lib/fixture-repo.ts";
import { settingsFile } from "../lib/settings-file.ts";

const open = fixtureRepos("checks-frontend-syntax-options-");

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

test("a named size in the font shorthand fails, directly and through a local alias holding it", async () => {
  const { write, script } = await open({
    "checks.config.ts": settingsFile({ frontendSyntax: { inputs: ["src/**/*.css"] } }),
    "stylelint.config.ts": stylelintConfig('{ baseline: "widely", tokens: ["src/tokens.css"] }'),
    "src/tokens.css": ":root {\n  --ink: #000;\n  --text-s: 0.875rem;\n  --weight: 400;\n}\n",
    "src/site.css": "p { font: italic var(--text-s) serif; }\n",
  });
  expect(await script(GATE)).toEqual({ exitCode: 0, text: "frontend-syntax: no violation in 2 file(s) from 1 declared input(s)\n" });

  await write({ "src/site.css": "p { font: var(--weight) small serif; }\n" });
  const direct = await script(GATE);
  expect(direct.text).toStartWith("frontend-syntax: 1 problem(s) in 2 file(s) from 1 declared input(s):\n  src/site.css:1:");
  expect(direct.text).toContain('Expected the font size from the token files rather than the literal "small" (checks/font-size-from-tokens)');
  expect(direct.exitCode).toBe(1);

  await write({ "src/site.css": "p { font: var(--weight) var(--rest); }\n:root { --rest: small serif; }\n" });
  const aliased = await script(GATE);
  expect(aliased.text).toStartWith("frontend-syntax: 1 problem(s) in 2 file(s) from 1 declared input(s):\n  src/site.css:1:");
  expect(aliased.text).toContain('Expected "--rest" from the token files rather than set in this file (checks/font-size-from-tokens)');
  expect(aliased.exitCode).toBe(1);
}, 60_000);

test("a named size fails only where the font size can stand, so a family name holding one passes", async () => {
  const { write, script } = await open({
    "checks.config.ts": settingsFile({ frontendSyntax: { inputs: ["src/**/*.css"] } }),
    "stylelint.config.ts": stylelintConfig('{ baseline: "widely", tokens: ["src/tokens.css"] }'),
    "src/tokens.css": ":root {\n  --ink: #000;\n  --text-s: 0.875rem;\n  --weight: 400;\n}\n",
    "src/site.css": ":root { --face: roboto medium, serif; }\np { font: var(--text-s) var(--face); }\nh1 { font: var(--text-s) / var(--leading) large type, serif; }\n",
  });
  expect(await script(GATE)).toEqual({ exitCode: 0, text: "frontend-syntax: no violation in 2 file(s) from 1 declared input(s)\n" });

  await write({ "src/site.css": "p { font: var(--weight) italic math serif; }\n" });
  const direct = await script(GATE);
  expect(direct.text).toStartWith("frontend-syntax: 1 problem(s) in 2 file(s) from 1 declared input(s):\n  src/site.css:1:");
  expect(direct.text).toContain('Expected the font size from the token files rather than the literal "math" (checks/font-size-from-tokens)');
  expect(direct.exitCode).toBe(1);

  await write({ "src/site.css": "p { font: var(--weight) var(--rest); }\n:root { --rest: math serif; }\n" });
  const aliased = await script(GATE);
  expect(aliased.text).toStartWith("frontend-syntax: 1 problem(s) in 2 file(s) from 1 declared input(s):\n  src/site.css:1:");
  expect(aliased.text).toContain('Expected "--rest" from the token files rather than set in this file (checks/font-size-from-tokens)');
  expect(aliased.exitCode).toBe(1);
}, 60_000);

test("a size custom property one style block of a page sets fails where another block or a style attribute reads it", async () => {
  const { write, script } = await open({
    "checks.config.ts": settingsFile({ frontendSyntax: { inputs: ["src/**/*.html"] } }),
    "stylelint.config.ts": stylelintConfig('{ baseline: "widely", tokens: ["src/tokens.css"] }'),
    "src/page.html": '<style>:root { --gap: 12px; }</style>\n<p style="font-size: var(--text-s)"></p>\n',
  });
  expect(await script(GATE)).toEqual({ exitCode: 0, text: "frontend-syntax: no violation in 1 file(s) from 1 declared input(s)\n" });

  for (const page of ['<style>:root { --size: 12px; }</style>\n<p style="font-size: var(--size)"></p>\n', "<style>:root { --size: 12px; }</style>\n<style>p { font: var(--size) serif; }</style>\n"]) {
    await write({ "src/page.html": page });
    const red = await script(GATE);
    expect(red.text, page).toStartWith("frontend-syntax: 1 problem(s) in 1 file(s) from 1 declared input(s):\n  src/page.html:2:");
    expect(red.text, page).toContain('Expected "--size" from the token files rather than set in this file (checks/font-size-from-tokens)');
    expect(red.exitCode, page).toBe(1);
  }
}, 60_000);

test("a size custom property hundreds of style attributes read fails once per attribute", async () => {
  const { script } = await open({
    "checks.config.ts": settingsFile({ frontendSyntax: { inputs: ["src/**/*.html"] } }),
    "stylelint.config.ts": stylelintConfig('{ baseline: "widely", tokens: ["src/tokens.css"] }'),
    "src/page.html": `<style>:root { --size: 12px; }</style>\n${'<p style="font-size: var(--size)"></p>\n'.repeat(200)}`,
  });
  const red = await script(GATE);
  expect(red.text).toStartWith("frontend-syntax: 200 problem(s) in 1 file(s) from 1 declared input(s):\n  src/page.html:2:");
  expect(red.text).toContain('Expected "--size" from the token files rather than set in this file (checks/font-size-from-tokens)');
  expect(red.exitCode).toBe(1);
}, 60_000);

test("a long hex colour does not escape the base rule without token globs, while token rules leave declared token files alone", async () => {
  const { write, script } = await repository(WIDELY, { "src/site.css": "a { color: #ffffff; }\n" });
  const longHex = await script(GATE);
  expect(longHex.text).toContain('Expected "#ffffff" to be "#fff" (color-hex-length)');
  expect(longHex.exitCode).toBe(1);
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
  expect(missing.text).toContain("frontend-syntax: stylelint.config.ts is missing, and a repository that declares frontendSyntax in checks.config.ts writes it with defineConfig from @avi2dg/checks/stylelint");
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
