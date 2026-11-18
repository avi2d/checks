import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCi } from "../../lib/ci-command.ts";

const MAIN = "pages-publish";
const SOURCE = "0123456789abcdef0123456789abcdef01234567";

let root = "";

function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd, env: { ...gitEnv(), GIT_AUTHOR_NAME: "seed", GIT_AUTHOR_EMAIL: "seed@example.com", GIT_COMMITTER_NAME: "seed", GIT_COMMITTER_EMAIL: "seed@example.com" } });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`);
  return result.stdout.toString();
}

function gitEnv() {
  return { PATH: process.env["PATH"] ?? "", HOME: root, GIT_CONFIG_NOSYSTEM: "1" };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "publish-site-"));
  const seed = join(root, "seed");
  mkdirSync(join(seed, "old"), { recursive: true });
  writeFileSync(join(seed, "CNAME"), "example.com\n");
  writeFileSync(join(seed, "old", "page.html"), "stale");
  git(root, "init", "--quiet", "--bare", "--initial-branch=main", "origin.git");
  git(seed, "init", "--quiet", "--initial-branch=main");
  git(seed, "add", "--all");
  git(seed, "commit", "--quiet", "-m", "seed");
  git(seed, "push", "--quiet", join(root, "origin.git"), "HEAD:main");
  git(root, "clone", "--quiet", join(root, "origin.git"), "site");
  mkdirSync(join(root, "dist", "_assets"), { recursive: true });
  writeFileSync(join(root, "dist", "index.html"), "home");
  writeFileSync(join(root, "dist", "_assets", "app.js"), "app");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function publish(part: string, overrides: Readonly<Record<string, string>> = {}) {
  return runCi(
    MAIN,
    [part],
    {
      ...gitEnv(),
      DEPLOY_KEY: "deploy-key-value",
      SITE_PATH: "site",
      DIRECTORY: "dist",
      REPOSITORY: "owner/site.github.io",
      CNAME: "example.com",
      BRANCH: "main",
      COMMIT_MESSAGE: "Publish site",
      SOURCE_SHA: SOURCE,
      ...overrides,
    },
    root,
  );
}

const published = () => git(root, "--git-dir=origin.git", "ls-tree", "-r", "--name-only", "main").trim().split("\n");

test("a publish that drops CNAME, keeps stale pages, loses _assets or leaves out .nojekyll fails", async () => {
  const ran = await publish("publish");
  expect(ran.exitCode).toBe(0);
  expect(published()).toEqual([".nojekyll", "CNAME", "_assets/app.js", "index.html"]);
  expect(git(root, "--git-dir=origin.git", "log", "-1", "--format=%an <%ae>|%cn|%s", "main").trim()).toBe(
    "github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>|github-actions[bot]|Publish site 0123456",
  );
});

test("a build CNAME naming another domain that replaces the checked one fails", async () => {
  writeFileSync(join(root, "dist", "CNAME"), "other.example\n");
  const ran = await publish("publish");
  expect(ran.exitCode).toBe(0);
  expect(readFileSync(join(root, "site", "CNAME"), "utf8")).toBe("example.com\n");
  expect(git(root, "--git-dir=origin.git", "show", "main:CNAME").trim()).toBe("example.com");
});

test("an unchanged build that commits again fails", async () => {
  await publish("publish");
  const before = git(root, "--git-dir=origin.git", "rev-parse", "main");
  const ran = await publish("publish");
  expect(ran.exitCode).toBe(0);
  expect(ran.stdout).toContain("owner/site.github.io already holds this build");
  expect(git(root, "--git-dir=origin.git", "rev-parse", "main")).toBe(before);
});

test("a publish to a repository whose CNAME names another domain that pushes passes", async () => {
  const ran = await publish("publish", { CNAME: "other.example" });
  expect(ran.exitCode).toBe(1);
  expect(ran.stdout).toContain("::error::owner/site.github.io holds no CNAME naming other.example");
  expect(existsSync(join(root, "site", "old", "page.html"))).toBe(true);
});

test("an empty deploy key let through the guard passes", async () => {
  const ran = await publish("guard", { DEPLOY_KEY: "" });
  expect(ran.exitCode).toBe(1);
  expect(ran.stdout).toContain("::error::pages-publish needs the deploy-key input, and it is empty");
  expect((await publish("guard")).exitCode).toBe(0);
});

test("a part other than guard or publish that runs either passes", async () => {
  const ran = await publish("both");
  expect(ran.exitCode).toBe(1);
  expect(ran.stdout).toContain("::error::pages-publish takes guard or publish, not both");
  expect(readFileSync(join(root, "site", "CNAME"), "utf8")).toBe("example.com\n");
});
