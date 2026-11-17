import { $ } from "bun";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { page } from "../e2e/lib/browser-site.ts";
import { CHECKOUT, fixtureRepos, ran, type FixtureRepo } from "../e2e/lib/fixture-repo.ts";

const open = fixtureRepos("checks-browser-scope-");
const runner = join(CHECKOUT, "src/quality/browser/browser.ts");

function settings(extra: string): string {
  return `export default {
    browser: {
      site: "dist",
      routes: [{ path: "/", locale: "en" }, { path: "/other/", locale: "en" }],
      viewports: [{ name: "phone", width: 320, height: 640 }],
      states: [{ name: "default" }],
      targets: [{ name: "main", selector: "main" }],
      checks: ["html", "links"]
    },
    ${extra}
  };\n`;
}

async function eventFor(repo: FixtureRepo, head: string): Promise<string> {
  const event = join(repo.dir, "event.json");
  await Bun.write(event, JSON.stringify({ pull_request: { number: 1, title: "change", base: { ref: "main" }, head: { sha: head } } }));
  return event;
}

async function run(repo: FixtureRepo, head: string) {
  const event = await eventFor(repo, head);
  return ran($`bun ${runner} --pr ${repo.dir}`.cwd(repo.dir).env({ ...process.env, GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: event }));
}

async function base(repo: FixtureRepo): Promise<void> {
  await repo.commit("base");
  await $`git update-ref refs/remotes/origin/main HEAD`.cwd(repo.dir).quiet();
}

test("a mapped home change leaves unrelated content checks out but still checks incoming links", async () => {
  const repo = await open({
    ".gitignore": "event.json\n",
    "checks.config.ts": settings('browserRoutes: { "src/home.ts": ["/"] },'),
    "src/home.ts": "home\n",
    "dist/index.html": page('<a href="/">home</a>'),
    "dist/other/index.html": page('<a href="/">other</a>'),
  });
  await base(repo);
  await repo.write({ "src/home.ts": "changed\n" });
  const result = await run(repo, await repo.commit("home"));
  expect(result.exitCode).toBe(0);
  expect(result.text).toContain("html at / (en)");
  expect(result.text).not.toContain("html at /other/ (en)");
  expect(result.text).toContain("links at /other/ (en)");
}, 60_000);

test("a mapped stylesheet narrows the route selection instead of widening it", async () => {
  const repo = await open({
    ".gitignore": "event.json\n",
    "checks.config.ts": settings('browserRoutes: { "src/site.css": ["/"] },'),
    "src/site.css": "body {}\n",
    "dist/index.html": page('<a href="/">home</a>'),
    "dist/other/index.html": page('<a href="/">other</a>'),
  });
  await base(repo);
  await repo.write({ "src/site.css": "body { color: black; }\n" });
  const result = await run(repo, await repo.commit("style"));
  expect(result.exitCode).toBe(0);
  expect(result.text).toContain("html at / (en)");
  expect(result.text).not.toContain("html at /other/ (en)");
}, 60_000);

test("test-only changes skip the browser only when both builds match the served site", async () => {
  const html = page('<a href="/">home</a>');
  const other = page('<a href="/">other</a>');
  const script = `import { mkdir } from "node:fs/promises";
await mkdir("dist/other", { recursive: true });
await Bun.write("dist/index.html", ${JSON.stringify(html)});
await Bun.write("dist/other/index.html", ${JSON.stringify(other)});
`;
  const repo = await open({
    ".gitignore": "dist/\nevent.json\n",
    "checks.config.ts": settings('browserBuild: ["bun", "build-site.ts"],'),
    "build-site.ts": script,
    "tests/home.test.ts": "before\n",
  });
  await base(repo);
  await repo.write({ "tests/home.test.ts": "after\n" });
  const head = await repo.commit("test");
  await $`bun build-site.ts`.cwd(repo.dir).quiet();
  const identical = await run(repo, head);
  expect(identical.exitCode).toBe(0);
  expect(identical.text).toContain("the test-only change builds the same site");
  expect(identical.text).not.toContain("targets at /");

  await repo.write({ "dist/index.html": page('<a href="/">different</a>') });
  const different = await run(repo, head);
  expect(different.text).not.toContain("the test-only change builds the same site");
  expect(different.text).toContain("targets at /");
}, 60_000);

test("a test file that changes rendered output or breaks the build does not skip the browser", async () => {
  const html = page('<a href="/">home</a>');
  const script = `import { mkdir } from "node:fs/promises";
const value = await Bun.file("tests/home.test.ts").text();
if (value.includes("FAIL")) process.exit(1);
await mkdir("dist/other", { recursive: true });
await Bun.write("dist/index.html", ${JSON.stringify(html)}.replace("home</a>", value + "</a>"));
await Bun.write("dist/other/index.html", ${JSON.stringify(html)});
`;
  const repo = await open({
    ".gitignore": "dist/\nevent.json\n",
    "checks.config.ts": settings('browserBuild: ["bun", "build-site.ts"],'),
    "build-site.ts": script,
    "tests/home.test.ts": "before",
  });
  await base(repo);
  await repo.write({ "tests/home.test.ts": "after" });
  const head = await repo.commit("rendered change");
  await $`bun build-site.ts`.cwd(repo.dir).quiet();
  const different = await run(repo, head);
  expect(different.text).not.toContain("the test-only change builds the same site");
  expect(different.text).toContain("targets at /");

  await repo.write({ "tests/home.test.ts": "FAIL" });
  const failed = await run(repo, await repo.commit("failed build"));
  expect(failed.text).not.toContain("the test-only change builds the same site");
  expect(failed.text).toContain("targets at /");
}, 60_000);
