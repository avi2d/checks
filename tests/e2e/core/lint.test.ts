import { $ } from "bun";
import { expect, test } from "bun:test";
import { Schema } from "effect";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CHECKOUT, lintWiring, withOwnInstall } from "../lib/fixture-repo.ts";
import { commit, lint, open, repository, STRANGER } from "../lib/lint-fixture.ts";

test("the local range starts at origin/HEAD, and explicit bad refs are refused", async () => {
  const { repo, base } = await repository();
  await repo.write({ "clean.ts": "export const clean = 42;\n" });
  const head = await commit(repo, "feat: clean", ["-c", "user.name=Wren Fixture", "-c", "user.email=wren@example.com"]);
  const green = await lint(repo);
  expect(green.text).toContain(`checks-lint: range ${base}..${head} from HEAD against origin/main`);
  expect(green.text).toContain("checks-lint: 13 gate(s) pass");
  expect(green.exitCode).toBe(0);
  const missing = await lint(repo, [base, "missing"]);
  expect(missing.exitCode).toBe(2);
  expect(missing.text).toContain("missing is not a commit");
}, 60_000);

test("checks-lint finds oxlint and jscpd in the repository's own install when PATH lacks node_modules/.bin", async () => {
  const repo = await open({
    ...lintWiring(),
    ".jscpd.json": JSON.stringify({ path: ["src"] }),
    "src/ledger.ts": [
      "export function ledgerSum(rows: readonly number[]): number {",
      "  let total = 0;",
      "  for (const row of rows) {",
      "    if (row > 10) total += row * 2;",
      "    else if (row < 0) total -= row;",
      "    else total += 1;",
      "    if (total > 1000) return 1000;",
      "  }",
      "  return total;",
      "}",
      "",
    ].join("\n"),
  });
  await withOwnInstall(repo);
  await commit(repo, "feat: base");
  const stripped = (process.env["PATH"] ?? "").split(":").filter((entry) => !entry.includes("node_modules")).join(":");
  const green = await lint(repo, [], { PATH: stripped });
  expect(green.text).toContain("lint-coverage: 2/2 tracked .ts/.tsx/.astro files");
  expect(green.text).toContain("repetition: 1 file(s) .jscpd.json holds repeat no more lines than where the range starts");
  expect(green.text).toContain("checks-lint: 13 gate(s) pass");
  expect(green.exitCode).toBe(0);

  const manifest = Schema.decodeUnknownSync(Schema.Struct({ devDependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)) }))(
    await Bun.file(join(CHECKOUT, "package.json")).json(),
  );
  const { oxlint = "", jscpd = "" } = manifest.devDependencies ?? {};
  const oxlintVersion = await $`${join(repo.dir, "node_modules", ".bin", "oxlint")} --version`.env({ ...process.env, PATH: stripped }).quiet();
  expect(oxlintVersion.stdout.toString()).toContain(oxlint);
  const jscpdVersion = await $`${process.execPath} ${join(repo.dir, "node_modules", ".bin", "jscpd")} --version`
    .env({ ...process.env, PATH: stripped })
    .quiet();
  expect(jscpdVersion.stdout.toString()).toContain(jscpd);
}, 120_000);

test("a pushed tip runs every range gate and names each failure", async () => {
  const { repo } = await repository();
  await $`git checkout -q main`.cwd(repo.dir).quiet();
  await repo.write({ "widget.ts": "// @ts-ignore\nexport const widget = 42;\n" });
  await writeFile(join(repo.dir, "oxlint-suppressions.json"), JSON.stringify({ "widget.ts": { "eslint/no-debugger": { count: 1 } } }));
  const tip = await commit(repo, "feat: pushed", STRANGER);
  await $`git update-ref refs/remotes/origin/main HEAD`.cwd(repo.dir).quiet();
  const red = await lint(repo);
  expect(red.text).toContain(`checks-lint: tip ${tip} from HEAD against origin/main`);
  expect(red.text).toContain("checks-commit-identity, checks-comment-gate, checks-suppressions-ratchet");
  expect(red.exitCode).toBe(1);
}, 60_000);

test("a pull request event ends the range at its head rather than the checked-out merge commit", async () => {
  const { repo, base } = await repository();
  await repo.write({ "clean.ts": "export const clean = 42;\n" });
  const head = await commit(repo, "feat: clean", ["-c", "user.name=Wren Fixture", "-c", "user.email=wren@example.com"]);
  await $`git checkout -q --detach main && git -c user.name=GitHub -c user.email=noreply@github.com merge -q --no-ff --no-gpg-sign -m merge feature`.cwd(repo.dir).quiet();
  const event = join(repo.dir, "event.json");
  await writeFile(event, JSON.stringify({ pull_request: { number: 7, base: { ref: "main" }, head: { sha: head } } }));
  const green = await lint(repo, [], { GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: event });
  expect(green.text).toContain(`checks-lint: range ${base}..${head} from pull request #7 into main`);
  expect(green.text).toContain("checks-lint: 13 gate(s) pass");
  expect(green.exitCode).toBe(0);
}, 60_000);

