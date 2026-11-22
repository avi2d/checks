import { expect, test } from "bun:test";
import { lintWiring } from "../lib/fixture-repo.ts";
import { commit, lint, repository } from "../lib/lint-fixture.ts";
import { settingsFile } from "../lib/settings-file.ts";

test("a workflow omission makes the lint gate fail and restoring it makes it pass", async () => {
  const { repo } = await repository();
  await repo.write({ ".github/workflows/ci.yml": "on: pull_request\njobs:\n  checks:\n    runs-on: ubuntu-latest\n    timeout-minutes: 10\n    steps:\n      - run: bun run lint\n" });
  await commit(repo, "chore: omit test");
  const red = await lint(repo);
  expect(red.exitCode).toBe(1);
  expect(red.text).toContain("checks-ci-wiring");
  await repo.write(lintWiring());
  await commit(repo, "fix: restore workflow");
  const green = await lint(repo);
  expect(green.exitCode).toBe(0);
}, 60_000);

test("declaring copy in checks.config.ts opts a repository into checks-copy, which fails lint on a hyphen used as a dash in the declared copy", async () => {
  const { repo } = await repository();
  await repo.write({ "checks.config.ts": settingsFile({ copy: { inputs: ["content/*.md"] } }), "content/home.md": "Example - a site.\n" });
  await commit(repo, "feat: declare the copy");
  const red = await lint(repo);
  expect(red.text).toContain("content/home.md:1:9 carries `-`, a hyphen used as a dash");
  expect(red.text).toContain("checks-lint: 1 of 14 gate(s) failed: checks-copy");
  expect(red.exitCode).toBe(1);
  await repo.write({ "content/home.md": "Example, a site.\n" });
  await commit(repo, "fix: use a comma");
  const green = await lint(repo);
  expect(green.text).toContain("checks-lint: 14 gate(s) pass");
  expect(green.exitCode).toBe(0);
}, 60_000);

test("the source stage leaves copy over the built pages to the built stage, which fails on a page the build never wrote instead of passing", async () => {
  const { repo } = await repository();
  await repo.write({
    ".gitignore": "node_modules/\ndist/\n",
    "checks.config.ts": settingsFile({ copy: { inputs: ["content/*.md", "dist/*.html"] } }),
    "content/home.md": "Example, a site.\n",
  });
  await commit(repo, "feat: declare the built copy");
  const source = await lint(repo, ["--stage", "source"]);
  expect(source.text).toContain("checks-lint: the source stage leaves checks-copy to the built stage");
  expect(source.text).toContain("checks-lint: 13 gate(s) pass");
  expect(source.exitCode).toBe(0);
  const unbuilt = await lint(repo, ["--stage", "built"]);
  expect(unbuilt.text).toContain("checks-lint: the built stage judges the working tree");
  expect(unbuilt.text).toContain("dist/*.html: the declared input matches no Markdown or HTML file");
  expect(unbuilt.text).toContain("checks-lint: 1 of 1 gate(s) failed: checks-copy");
  expect(unbuilt.exitCode).toBe(1);
  await repo.write({ "dist/index.html": "<!doctype html><html lang=\"en\"><head><title>Home</title></head><body><p>Example - a site.</p></body></html>\n" });
  const dashed = await lint(repo, ["--stage", "built"]);
  expect(dashed.text).toContain("dist/index.html:1:");
  expect(dashed.text).toContain("a hyphen used as a dash");
  expect(dashed.exitCode).toBe(1);
  await repo.write({ "dist/index.html": "<!doctype html><html lang=\"en\"><head><title>Home</title></head><body><p>Example, a site.</p></body></html>\n" });
  const built = await lint(repo, ["--stage", "built"]);
  expect(built.text).toContain("checks-lint: 1 gate(s) pass");
  expect(built.exitCode).toBe(0);
  const every = await lint(repo);
  expect(every.text).toContain("checks-lint: 14 gate(s) pass");
  expect(every.exitCode).toBe(0);
}, 120_000);

