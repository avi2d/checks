import { $ } from "bun";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { CHECKOUT, lintWiring, ran, withOwnInstall } from "../lib/fixture-repo.ts";
import { commit, lint, open, repository } from "../lib/lint-fixture.ts";

test("a pull request range that hides new lint findings behind oxlint --suppress-all fails checks-lint rather than passing", async () => {
  const { repo } = await repository();
  await repo.write({
    ".oxlintrc.json": JSON.stringify({ rules: { "no-debugger": "error" } }),
    "dispatch.ts": Array.from({ length: 100 }, (_, step) => `export function step${step}(): number {\n  debugger;\n  return ${step};\n}\n`).join(""),
  });
  const oxlint = join(CHECKOUT, "node_modules", ".bin", "oxlint");
  expect((await ran($`${oxlint} dispatch.ts`.cwd(repo.dir))).exitCode).toBe(1);
  await $`${oxlint} --suppress-all`.cwd(repo.dir).quiet().nothrow();
  expect((await ran($`${oxlint} dispatch.ts`.cwd(repo.dir))).exitCode).toBe(0);
  await commit(repo, "feat: dispatch");
  const red = await lint(repo);
  expect(red.text).toContain("oxlint-suppressions.json dispatch.ts no-debugger appeared with 100");
  expect(red.text).toContain("checks-lint: 1 of 13 gate(s) failed: checks-suppressions-ratchet");
  expect(red.exitCode).toBe(1);
}, 60_000);

test("checks-lint --whole-tree runs only the four whole-tree gates over the whole tree at HEAD", async () => {
  const { repo } = await repository();
  await repo.write({ "clean.ts": "export const clean = 42;\n" });
  await commit(repo, "feat: clean");
  const whole = await lint(repo, ["--whole-tree"]);
  expect(whole.text).toContain("from the whole tree at HEAD");
  expect(whole.text).toContain("lint-coverage: 3/3 tracked .ts/.tsx/.astro files");
  expect(whole.text).toContain("suppressions-ratchet: no count in oxlint-suppressions.json or stylelint-suppressions.json rose or appeared");
  expect(whole.text).toContain(".jscpd.json holds repeat no lines at the head");
  expect(whole.text).toContain("quarantine-clock: no test in tests/quarantine/ is past 30 days");
  expect(whole.text).toContain("checks-lint: 4 gate(s) pass");
  expect(whole.exitCode).toBe(0);
}, 60_000);

test("checks-lint --whole-tree finds oxlint and jscpd in the repository's own install when PATH lacks node_modules/.bin", async () => {
  const repo = await open({
    ...lintWiring(),
    ".jscpd.json": JSON.stringify({ path: ["src"] }),
    "src/tally.ts": [
      "export const tally00 = 0;",
      "export const tally01 = 1;",
      "export const tally02 = 2;",
      "export const tally03 = 3;",
      "export const tally04 = 4;",
      "export const tally05 = 5;",
      "export const tally06 = 6;",
      "export const tally07 = 7;",
      "export const tally08 = 8;",
      "export const tally09 = 9;",
      "",
    ].join("\n"),
  });
  await withOwnInstall(repo);
  await commit(repo, "feat: base");
  const stripped = (process.env["PATH"] ?? "").split(":").filter((entry) => !entry.includes("node_modules")).join(":");
  const whole = await lint(repo, ["--whole-tree"], { PATH: stripped });
  expect(whole.text).toContain("from the whole tree at HEAD");
  expect(whole.text).toContain("lint-coverage: 2/2 tracked .ts/.tsx/.astro files");
  expect(whole.text).toContain("repetition: 1 file(s) .jscpd.json holds repeat no lines at the head, at 50 tokens and 5 lines");
  expect(whole.text).toContain("checks-lint: 4 gate(s) pass");
  expect(whole.exitCode).toBe(0);
}, 120_000);
