import { $ } from "bun";
import { expect, test } from "bun:test";
import { mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ran, scratchDirs } from "../e2e/lib/fixture-repo.ts";
import { browserConsumer } from "../e2e/lib/packed.ts";

const scratch = scratchDirs();

const BUILT = {
  "index.html": "<title>Home</title><a href=about>About</a>",
  "about/index.html": "<title>About</title>",
  "notes.html": "<title>Notes</title>",
  "style.css": "body { margin: 0 }",
};

const HANGING_CLOSE_SUITE = `import { $ } from "bun";
import { writeFile } from "node:fs/promises";
import { siteTest } from "@avi2dg/checks/site-test.ts";

const marker = process.env.SITE_PROCESS_MARKER;
const observed = process.env.SITE_PROCESS_OBSERVED;
siteTest("starts a browser whose close hangs", { site: "dist", launch: { args: [\`--site-process-marker=\${marker}\`] } }, async (site) => {
  const processes = await $\`ps -eo args=\`.text();
  await writeFile(observed, processes.includes(\`--site-process-marker=\${marker}\`) ? "seen" : "missing");
  site.browser.close = () => new Promise(() => {});
});
`;

const SUITE = `import { expect } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { pageUrl, siteTest } from "@avi2dg/checks/site-test.ts";

const dist = join(import.meta.dir, "..", "..", "dist");

const titles = async (site) => {
  const tab = await (await site.browser.newContext()).newPage();
  const seen = [];
  for (const page of site.pages) {
    await tab.goto(pageUrl(site, page));
    seen.push(await tab.title());
  }
  return seen;
};

for (const engine of ["chromium", "webkit"]) {
  siteTest(\`\${engine} serves every built page\`, { site: dist, engine }, async (site) => {
    expect(site.browser.browserType().name()).toBe(engine);
    expect(site.pages).toEqual(["/", "/about/", "/notes.html"]);
    expect(await titles(site)).toEqual(["Home", "About", "Notes"]);
  });
}

siteTest("a later test gets the browser with no context left open, and a site its builder returns", { site: () => Promise.resolve(dist) }, async (site) => {
  expect(site.browser.contexts()).toHaveLength(0);
  const tab = await (await site.browser.newContext()).newPage();
  await tab.goto(new URL("about", site.url).href);
  expect([new URL(tab.url()).pathname, await tab.title()]).toEqual(["/about/", "About"]);
});

siteTest("a recording lands in the directory the test names", { site: dist }, async (site) => {
  const dir = join(dist, "..", "videos");
  await mkdir(dir, { recursive: true });
  const context = await site.browser.newContext({ recordVideo: { dir } });
  const page = await context.newPage();
  await page.goto(new URL("about", site.url).href);
  await context.close();
  const video = page.video();
  expect(video).not.toBeNull();
  const path = video === null ? "" : await video.path();
  expect(path.startsWith(\`\${dir}/\`)).toBe(true);
  expect(existsSync(path)).toBe(true);
});

siteTest("a site never built", { site: join(dist, "..", "missing") }, async () => undefined);
`;

test(
  "a hanging close leaves no marked browser process after the test process exits",
  async () => {
    const dir = await browserConsumer(scratch, "site-close");
    await mkdir(join(dir, "dist"), { recursive: true });
    await writeFile(join(dir, "dist", "index.html"), "<title>Site</title>");
    await mkdir(join(dir, "tests", "e2e"), { recursive: true });
    await writeFile(join(dir, "tests", "e2e", "close.test.ts"), HANGING_CLOSE_SUITE);
    const marker = join(dir, "browser-marker");
    const observed = join(dir, "observed");
    const run = await ran($`timeout 30s bun test tests/e2e/close.test.ts`.cwd(dir).env({ ...process.env, SITE_PROCESS_MARKER: marker, SITE_PROCESS_OBSERVED: observed }));

    expect(run.exitCode).toBe(0);
    expect(await readFile(observed, "utf8")).toBe("seen");
    const processes = await $`ps -eo args=`.text();
    expect(processes).not.toContain(`--site-process-marker=${marker}`);
  },
  300_000,
);

test(
  "a consumer's site tests get every built page served and a recording where the test names it, and a site never built fails its test, instead of testing a page the build never wrote",
  async () => {
    const dir = await browserConsumer(scratch, "site-test");
    for (const [file, text] of Object.entries(BUILT)) {
      await mkdir(join(dir, "dist", file, ".."), { recursive: true });
      await writeFile(join(dir, "dist", file), text);
    }
    await mkdir(join(dir, "tests", "e2e"), { recursive: true });
    await writeFile(join(dir, "tests", "e2e", "site.test.ts"), SUITE);

    const run = await ran($`bun test tests/e2e`.cwd(dir));

    expect(run.exitCode).toBe(1);
    expect(run.text).toContain("4 pass");
    expect(run.text).toContain("1 fail");
    expect(run.text).toContain("(fail) a site never built");
    expect(run.text).toContain(`the site ${join(await realpath(dir), "missing")} is not a directory, so build the site before its tests run`);
    const videos = await readdir(join(dir, "videos"));
    expect(videos).toHaveLength(1);
    expect(videos[0]?.endsWith(".webm")).toBe(true);
  },
  300_000,
);
