import { $ } from "bun";
import { expect, test } from "bun:test";
import { fixtureRepos } from "./lib/fixture-repo.ts";

const open = fixtureRepos("checks-copy-");

const GATE = "docs/copy.ts";

const HYPHEN = "carries `-`, a hyphen used as a dash. End the sentence, or use a comma";

const REPORTED = "## Что уже запущено\n\n- [hexn.io](https://hexn.io/ru) - платформа криптовалютной торговли и\n  сбережений\n";
const FIXED = "## Что уже запущено\n\n- [hexn.io](https://hexn.io/ru), платформа криптовалютной торговли и\n  сбережений\n";
const BUILT = '<!doctype html>\n<html lang="ru"><head><title>Example</title></head>\n<body><p><a href="https://hexn.io/ru">hexn.io</a> - платформа</p></body></html>\n';

const DECLARED = { "copy.json": JSON.stringify({ inputs: ["src/content/**/*.md", "dist/**/*.html"] }) };

test("red on the hexn.io line from the website's home page, in its Markdown and its built page, and green on the comma form", async () => {
  const { write, script } = await open({ ...DECLARED, "src/content/home.ru.md": REPORTED, "dist/index.html": BUILT });
  const red = await script(GATE);
  expect(red.text).toBe(
    [
      "copy: 2 problem(s) in 2 file(s) from 2 declared input(s):",
      `  dist/index.html:3:51 ${HYPHEN}`,
      `  src/content/home.ru.md:3:33 ${HYPHEN}`,
      "",
    ].join("\n"),
  );
  expect(red.exitCode).toBe(1);

  await write({ "src/content/home.ru.md": FIXED, "dist/index.html": BUILT.replace("</a> -", "</a>,") });
  const green = await script(GATE);
  expect(green.text).toBe("copy: no violation in 2 file(s) from 2 declared input(s)\n");
  expect(green.exitCode).toBe(0);
}, 60_000);

test("a declared input that matches no file, or a file of another kind, fails until the declaration names copy", async () => {
  const { write, script } = await open({ "copy.json": JSON.stringify({ inputs: ["src/content/*", "dist/**/*.html"] }), "src/content/home.ru.md": FIXED, "src/content/site.ts": "export {};\n" });
  const red = await script(GATE);
  expect(red.text).toBe(
    [
      "copy: 2 problem(s) in 1 file(s) from 2 declared input(s):",
      "  dist/**/*.html: the declared input matches no Markdown or HTML file",
      "  src/content/site.ts: is neither Markdown nor HTML, so the gate cannot read it",
      "",
    ].join("\n"),
  );
  expect(red.exitCode).toBe(1);

  await write({ "copy.json": JSON.stringify({ inputs: ["src/content/*.md"] }) });
  const green = await script(GATE);
  expect(green.text).toBe("copy: no violation in 1 file(s) from 1 declared input(s)\n");
  expect(green.exitCode).toBe(0);
}, 60_000);

test("a repository without the declaration, or with an empty input list, is refused before anything is judged", async () => {
  const { dir, write, script } = await open({ "src/content/home.ru.md": REPORTED });
  const undeclared = await script(GATE);
  expect(undeclared.text).toContain("copy: copy.json is missing, and a repository opts in to this gate by declaring its copy there");
  expect(undeclared.exitCode).toBe(2);

  await write({ "copy.json": JSON.stringify({ inputs: [] }) });
  const empty = await script(GATE);
  expect(empty.text).toContain("copy: copy.json does not decode");
  expect(empty.exitCode).toBe(2);

  await $`rm copy.json`.cwd(dir).quiet();
  expect((await script(GATE)).exitCode).toBe(2);
}, 60_000);
