import { expect, test } from "bun:test";
import { join } from "node:path";
import { CHECKOUT } from "../lib/fixture-repo.ts";
import { commit, lint, repository } from "../lib/lint-fixture.ts";
import { settingsFile } from "../lib/settings-file.ts";

test("the source stage still runs copy over tracked Markdown, rather than leaving every declared gate to the built stage", async () => {
  const { repo } = await repository();
  await repo.write({ "checks.config.ts": settingsFile({ copy: { inputs: ["content/*.md"] } }), "content/home.md": "Example - a site.\n" });
  await commit(repo, "feat: declare the copy");
  const source = await lint(repo, ["--stage", "source"]);
  expect(source.text).toContain("checks-lint: 1 of 14 gate(s) failed: checks-copy");
  expect(source.exitCode).toBe(1);
  const built = await lint(repo, ["--stage", "built"]);
  expect(built.text).toContain("checks-lint: 0 gate(s) pass");
  expect(built.exitCode).toBe(0);
  const mixed = await lint(repo, ["--stage", "built", "--full"]);
  expect(mixed.exitCode).toBe(2);
}, 60_000);

test("a stale non-ignored input is not left to the built stage to pass silently", async () => {
  const { repo } = await repository();
  await repo.write({ "checks.config.ts": settingsFile({ copy: { inputs: ["content/*.md", "deleted/*.md"] } }), "content/guide.md": "Example, a site.\n" });
  await commit(repo, "feat: declare the copy");
  const source = await lint(repo, ["--stage", "source"]);
  expect(source.text).not.toContain("leaves checks-copy to the built stage");
  expect(source.text).toContain("deleted/*.md: the declared input matches no Markdown or HTML file");
  expect(source.text).toContain("checks-lint: 1 of 14 gate(s) failed: checks-copy");
  expect(source.exitCode).toBe(1);
}, 60_000);

test("a copy.json still tracked runs checks-copy, which fails lint naming the checks.config.ts key instead of skipping the gate", async () => {
  const { repo } = await repository();
  await repo.write({ "copy.json": JSON.stringify({ inputs: ["content/*.md"] }), "content/home.md": "Example - a site.\n" });
  await commit(repo, "feat: declare the copy the old way");
  const red = await lint(repo);
  expect(red.text).toContain("copy: copy.json is no longer read; move it to the copy key of checks.config.ts");
  expect(red.text).toContain("checks-copy");
  expect(red.exitCode).not.toBe(0);
}, 60_000);

test("declaring frontendSyntax in checks.config.ts opts a repository into checks-frontend-syntax, which fails lint on a seeded transition all", async () => {
  const { repo } = await repository();
  await repo.write({
    "checks.config.ts": settingsFile({ frontendSyntax: { inputs: ["styles/*.css"] } }),
    "stylelint.config.ts": `import { defineConfig } from ${JSON.stringify(join(CHECKOUT, "src", "quality", "presets", "stylelint.ts"))};\n\nexport default defineConfig({ baseline: "widely", tokens: false });\n`,
    "styles/site.css": "a { transition: all 1s; }\n",
  });
  await commit(repo, "feat: declare the stylesheets");
  const red = await lint(repo);
  expect(red.text).toContain('styles/site.css:1:17 Disallowed value "all 1s" for property "transition"');
  expect(red.text).toContain("checks-lint: 1 of 15 gate(s) failed: checks-frontend-syntax");
  expect(red.exitCode).toBe(1);
  await repo.write({ "styles/site.css": "a { transition: color 1s; }\n" });
  await commit(repo, "fix: name the property");
  const green = await lint(repo);
  expect(green.text).toContain("checks-lint: 15 gate(s) pass");
  expect(green.exitCode).toBe(0);
}, 120_000);

