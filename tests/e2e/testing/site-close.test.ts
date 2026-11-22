import { $ } from "bun";
import { expect, test } from "bun:test";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CHECKOUT, ran, scratchDirs } from "../lib/fixture-repo.ts";

const scratch = scratchDirs();

test("a browser with a hanging close does not time out afterAll or leave its server running", async () => {
  const dir = await scratch("site-close-");
  const site = join(dir, "site");
  const marker = join(dir, "killed");
  await mkdir(site);
  await symlink(join(CHECKOUT, "node_modules"), join(dir, "node_modules"));
  await writeFile(join(site, "index.html"), "<title>Site</title>");
  const suite = join(dir, "site.test.ts");
  await writeFile(
    suite,
    `import { mock } from "bun:test";
import { writeFile } from "node:fs/promises";

const device = { userAgent: "fixture", deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const browser = {
  isConnected: () => true,
  contexts: () => [],
  close: () => new Promise(() => {}),
  _channel: { killForTests: () => writeFile(${JSON.stringify(marker)}, "killed") },
};
const engine = { launch: () => Promise.resolve(browser) };
mock.module("playwright-core", () => ({
  chromium: engine,
  webkit: engine,
  devices: {
    "iPhone 14": device,
    "iPhone 16 Plus": device,
    "iPhone 16 Pro Max": device,
    "Pixel 7": device,
    "iPad (gen 6)": device,
  },
}));
const { siteTest } = await import(${JSON.stringify(join(CHECKOUT, "src/testing/site-test.ts"))});
siteTest("serves the site", { site: ${JSON.stringify(site)} }, async () => {});
`,
  );

  const run = await ran($`bun test ${suite}`.cwd(CHECKOUT));

  expect(run.exitCode).toBe(0);
  expect(await readFile(marker, "utf8")).toBe("killed");
}, 20_000);
