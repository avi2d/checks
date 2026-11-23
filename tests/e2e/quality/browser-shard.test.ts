import { $ } from "bun";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { browserSite, declaration, page } from "../lib/browser-site.ts";
import { CHECKOUT, ran } from "../lib/fixture-repo.ts";

const runner = join(CHECKOUT, "src", "quality", "browser", "browser.ts");

test("a shard left with no route checks no page and passes instead of failing as an empty declaration", async () => {
  const site = await browserSite({ "checks.config.ts": declaration({ checks: ["html"] }), "dist/index.html": page('<a href="/">home</a>') });
  const result = await ran($`bun ${runner} --shard=2/2`.cwd(site.dir));
  expect(result.text).toContain("browser: shard 2 of 2 checks no route");
  expect(result.text).toContain("browser: this shard holds no check, so no page was checked");
  expect(result.text).not.toContain("the declaration leaves no check to run");
  expect(result.exitCode).toBe(0);
}, 60_000);

test("a shard left with no route fails on a missing route without also calling the declaration empty", async () => {
  const routes = [{ path: "/", locale: "en" }, { path: "/ru/", locale: "ru" }];
  const site = await browserSite({ "checks.config.ts": declaration({ routes, checks: ["html"] }), "dist/index.html": page('<a href="/">home</a>') });
  const result = await ran($`bun ${runner} --shard=2/2`.cwd(site.dir));
  expect(result.text).toContain("browser: shard 2 of 2 checks no route");
  expect(result.text).toContain("  route /ru/ serves no page from the declared site");
  expect(result.text).not.toContain("the declaration leaves no check to run");
  expect(result.exitCode).toBe(1);
}, 60_000);
