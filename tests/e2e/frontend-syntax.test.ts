import { $ } from "bun";
import { expect, test } from "bun:test";
import { fixtureRepos } from "./lib/fixture-repo.ts";

const open = fixtureRepos("checks-frontend-syntax-");

const GATE = "quality/frontend-syntax.ts";

const DECLARED = { "frontend-syntax.json": JSON.stringify({ inputs: ["src/**/*.css", "src/**/*.astro"] }) };

const CLEAN = {
  ...DECLARED,
  "src/styles/site.css": "a { transition: color 200ms, transform 200ms; }\n.handle { user-select: none; }\n",
  "src/layouts/Base.astro": "---\nconst title = 'Home';\n---\n<html><head><title>{title}</title></head><body><slot /></body></html>\n<style>body { margin: 0; }</style>\n",
};

const SEEDED = [
  {
    rule: "transition all in a stylesheet",
    file: "src/styles/site.css",
    violation: "a { transition: all 200ms; }\n.handle { user-select: none; }\n",
    reported: 'src/styles/site.css:1:17 Disallowed value "all 200ms" for property "transition". Name the properties the transition animates.',
  },
  {
    rule: "transition-property all",
    file: "src/styles/site.css",
    violation: "a { transition-property: all; transition-duration: 200ms; }\n",
    reported: 'src/styles/site.css:1:26 Disallowed value "all" for property "transition-property"',
  },
  {
    rule: "transition all in an Astro style block",
    file: "src/layouts/Base.astro",
    violation: "---\n---\n<html><body><slot /></body></html>\n<style>a { -webkit-transition: all 1s; }</style>\n",
    reported: 'src/layouts/Base.astro:4:32 Disallowed value "all 1s" for property "-webkit-transition"',
  },
  {
    rule: "body-wide user-select",
    file: "src/styles/site.css",
    violation: "html, body { user-select: none; }\n",
    reported: 'src/styles/site.css:1:14 Disallowed property "user-select" for selector "html, body". Leave text selectable across the page',
  },
  {
    rule: "user-select on every element",
    file: "src/layouts/Base.astro",
    violation: "---\n---\n<html><body><slot /></body></html>\n<style>* { -webkit-user-select: none; }</style>\n",
    reported: 'src/layouts/Base.astro:4:12 Disallowed property "-webkit-user-select" for selector "*"',
  },
] as const;

for (const seeded of SEEDED) {
  test(`red on ${seeded.rule} and green once it is removed`, async () => {
    const { write, script } = await open(CLEAN);
    const green = await script(GATE);
    expect(green.text).toBe("frontend-syntax: no violation in 2 file(s) from 2 declared input(s)\n");
    expect(green.exitCode).toBe(0);

    await write({ [seeded.file]: seeded.violation });
    const red = await script(GATE);
    expect(red.text).toStartWith("frontend-syntax: 1 problem(s) in 2 file(s) from 2 declared input(s):\n");
    expect(red.text).toContain(`  ${seeded.reported}`);
    expect(red.exitCode).toBe(1);

    await write({ [seeded.file]: CLEAN[seeded.file] });
    expect(await script(GATE)).toEqual(green);
  }, 60_000);
}

test("a declared input that matches no file fails, and the gate passes once a file matches it", async () => {
  const { write, script } = await open({ ...CLEAN, "frontend-syntax.json": JSON.stringify({ inputs: ["src/**/*.css", "dist/**/*.html"] }) });
  const red = await script(GATE);
  expect(red.text).toBe("frontend-syntax: 1 problem(s) in 1 file(s) from 2 declared input(s):\n  dist/**/*.html: the declared input matches no file\n");
  expect(red.exitCode).toBe(1);

  await write({ "dist/index.html": "<!doctype html><html><head><style>p { transition: opacity 1s; }</style></head><body></body></html>\n" });
  const green = await script(GATE);
  expect(green.text).toBe("frontend-syntax: no violation in 2 file(s) from 2 declared input(s)\n");
  expect(green.exitCode).toBe(0);
}, 60_000);

test("a repository without the declaration, or with an empty input list, is refused before anything is judged", async () => {
  const { dir, write, script } = await open({ "src/styles/site.css": "a { transition: all 1s; }\n" });
  const undeclared = await script(GATE);
  expect(undeclared.text).toContain("frontend-syntax: frontend-syntax.json is missing, and a repository opts in to this gate by declaring its inputs there");
  expect(undeclared.exitCode).toBe(2);

  await write({ "frontend-syntax.json": JSON.stringify({ inputs: [] }) });
  const empty = await script(GATE);
  expect(empty.text).toContain("frontend-syntax: frontend-syntax.json does not decode");
  expect(empty.exitCode).toBe(2);

  await $`rm frontend-syntax.json`.cwd(dir).quiet();
  expect((await script(GATE)).exitCode).toBe(2);
}, 60_000);
