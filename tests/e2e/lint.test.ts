import { $ } from "bun";
import { expect, test } from "bun:test";
import { Schema } from "effect";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withoutPullRequestEvent } from "../lib/env.ts";
import { CHECKOUT, fixtureRepos, lintWiring, ran, withOwnInstall, type FixtureRepo, type Ran } from "./lib/fixture-repo.ts";

const SCRIPT = join(CHECKOUT, "src", "core", "lint.ts");
const OWNER = ["-c", "user.name=Wren Fixture", "-c", "user.email=wren@example.com"];
const STRANGER = ["-c", "user.name=stranger", "-c", "user.email=stranger@example.com"];
const open = fixtureRepos("checks-lint-");

async function commit(repo: FixtureRepo, message: string, identity: readonly string[] = OWNER): Promise<string> {
  await $`git add -A && git ${identity} commit -q --no-gpg-sign -m ${message}`.cwd(repo.dir).quiet();
  return (await $`git rev-parse HEAD`.cwd(repo.dir).quiet()).stdout.toString().trim();
}

async function repository(): Promise<{ repo: FixtureRepo; base: string }> {
  const repo = await open({ ...lintWiring(), "widget.ts": "export const widget = 42;\n" });
  await withOwnInstall(repo);
  const base = await commit(repo, "feat: base", ["-c", "user.name=Wren Fixture", "-c", "user.email=wren@example.com"]);
  await $`git update-ref refs/remotes/origin/main HEAD && git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main && git checkout -q -b feature`.cwd(repo.dir).quiet();
  return { repo, base };
}

function lint(repo: FixtureRepo, args: readonly string[] = [], env: Readonly<Record<string, string>> = {}): Promise<Ran> {
  return ran($`bun ${SCRIPT} ${args}`.cwd(repo.dir).env({ ...withoutPullRequestEvent(), PATH: `${join(CHECKOUT, "node_modules/.bin")}:${process.env["PATH"] ?? ""}`, ...env }));
}

test("the local range starts at origin/HEAD, and explicit bad refs are refused", async () => {
  const { repo, base } = await repository();
  await repo.write({ "clean.ts": "export const clean = 42;\n" });
  const head = await commit(repo, "feat: clean", ["-c", "user.name=Wren Fixture", "-c", "user.email=wren@example.com"]);
  const green = await lint(repo);
  expect(green.text).toContain(`checks-lint: range ${base}..${head} from HEAD against origin/main`);
  expect(green.text).toContain("checks-lint: 12 gate(s) pass");
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
  expect(green.text).toContain("checks-lint: 12 gate(s) pass");
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
  expect(green.text).toContain("checks-lint: 12 gate(s) pass");
  expect(green.exitCode).toBe(0);
}, 60_000);

test("a workflow omission makes the lint gate fail and restoring it makes it pass", async () => {
  const { repo } = await repository();
  await repo.write({ ".github/workflows/ci.yml": "on: pull_request\njobs:\n  checks:\n    runs-on: ubuntu-latest\n    steps:\n      - run: bun run lint\n" });
  await commit(repo, "chore: omit test");
  const red = await lint(repo);
  expect(red.exitCode).toBe(1);
  expect(red.text).toContain("checks-ci-wiring");
  await repo.write(lintWiring());
  await commit(repo, "fix: restore workflow");
  const green = await lint(repo);
  expect(green.exitCode).toBe(0);
}, 60_000);

test("tracking copy.json opts a repository into checks-copy, which fails lint on a hyphen used as a dash in the declared copy", async () => {
  const { repo } = await repository();
  await repo.write({ "copy.json": JSON.stringify({ inputs: ["content/*.md"] }), "content/home.md": "Example - a site.\n" });
  await commit(repo, "feat: declare the copy");
  const red = await lint(repo);
  expect(red.text).toContain("content/home.md:1:9 carries `-`, a hyphen used as a dash");
  expect(red.text).toContain("checks-lint: 1 of 13 gate(s) failed: checks-copy");
  expect(red.exitCode).toBe(1);
  await repo.write({ "content/home.md": "Example, a site.\n" });
  await commit(repo, "fix: use a comma");
  const green = await lint(repo);
  expect(green.text).toContain("checks-lint: 13 gate(s) pass");
  expect(green.exitCode).toBe(0);
}, 60_000);

test("tracking frontend-syntax.json opts a repository into checks-frontend-syntax, which fails lint on a seeded transition all", async () => {
  const { repo } = await repository();
  await repo.write({
    "frontend-syntax.json": JSON.stringify({ inputs: ["styles/*.css"] }),
    "stylelint.config.ts": `import { defineConfig } from ${JSON.stringify(join(CHECKOUT, "src", "quality", "presets", "stylelint.ts"))};\n\nexport default defineConfig({ baseline: "widely", tokens: false });\n`,
    "styles/site.css": "a { transition: all 1s; }\n",
  });
  await commit(repo, "feat: declare the stylesheets");
  const red = await lint(repo);
  expect(red.text).toContain('styles/site.css:1:17 Disallowed value "all 1s" for property "transition"');
  expect(red.text).toContain("checks-lint: 1 of 14 gate(s) failed: checks-frontend-syntax");
  expect(red.exitCode).toBe(1);
  await repo.write({ "styles/site.css": "a { transition: color 1s; }\n" });
  await commit(repo, "fix: name the property");
  const green = await lint(repo);
  expect(green.text).toContain("checks-lint: 14 gate(s) pass");
  expect(green.exitCode).toBe(0);
}, 60_000);
