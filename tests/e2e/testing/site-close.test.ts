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

const connection = {
  _isRemote: true,
  isRemote() {
    return this._isRemote;
  },
};
const browser = {
  _connection: connection,
  isConnected: () => true,
  contexts: () => [],
  close: () => new Promise(() => {}),
};
const server = {
  wsEndpoint: () => "endpoint",
  kill: () => writeFile(${JSON.stringify(marker)}, "killed"),
};
const engine = {
  launch: () => Promise.resolve(browser),
  launchServer: () => Promise.resolve(server),
  connect: () => Promise.resolve(browser),
};
mock.module("playwright-core", () => ({ chromium: engine, webkit: engine, devices: {} }));
const { siteTest } = await import(${JSON.stringify(join(CHECKOUT, "src/testing/site-test.ts"))});
siteTest("serves the site", { site: ${JSON.stringify(site)} }, async () => {});
`,
  );

  const run = await ran($`bun test ${suite}`.cwd(CHECKOUT));

  expect(run.exitCode).toBe(0);
  expect(await readFile(marker, "utf8")).toBe("killed");
}, 20_000);

test("a site callback reads the video path rather than failing as a remotely connected browser", async () => {
  const dir = await scratch("site-video-");
  const site = join(dir, "site");
  const out = join(dir, "video-path");
  const recording = join(dir, "recording.webm");
  await mkdir(site);
  await symlink(join(CHECKOUT, "node_modules"), join(dir, "node_modules"));
  await writeFile(join(site, "index.html"), "<title>Site</title>");
  const suite = join(dir, "site.test.ts");
  await writeFile(
    suite,
    `import { mock } from "bun:test";
import { writeFile } from "node:fs/promises";

const connection = {
  _isRemote: true,
  isRemote() {
    return this._isRemote;
  },
};
const video = {
  path: () => {
    if (connection.isRemote()) throw new Error("Path is not available when connecting remotely. Use saveAs() to save a local copy.");
    return ${JSON.stringify(recording)};
  },
};
const browser = {
  _connection: connection,
  isConnected: () => true,
  contexts: () => [],
  close: () => new Promise(() => {}),
  newContext: () =>
    Promise.resolve({
      newPage: () => Promise.resolve({ video: () => video, close: () => Promise.resolve() }),
      close: () => Promise.resolve(),
    }),
};
const server = {
  wsEndpoint: () => "endpoint",
  kill: () => Promise.resolve(),
};
const engine = {
  launch: () => Promise.reject(new Error("site-test connects to its own server instead of launching")),
  launchServer: () => Promise.resolve(server),
  connect: () => Promise.resolve(browser),
};
mock.module("playwright-core", () => ({ chromium: engine, webkit: engine, devices: {} }));
const { siteTest } = await import(${JSON.stringify(join(CHECKOUT, "src/testing/site-test.ts"))});
siteTest("serves the site", { site: ${JSON.stringify(site)} }, async (site) => {
  const page = await (await site.browser.newContext()).newPage();
  await writeFile(${JSON.stringify(out)}, await page.video().path());
});
`,
  );

  const run = await ran($`bun test ${suite}`.cwd(CHECKOUT));

  expect(run.exitCode).toBe(0);
  expect(await readFile(out, "utf8")).toBe(recording);
}, 20_000);
