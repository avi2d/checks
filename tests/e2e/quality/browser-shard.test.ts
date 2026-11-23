import { $ } from "bun";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { browserSite, declaration, page } from "../lib/browser-site.ts";
import { CHECKOUT, ran } from "../lib/fixture-repo.ts";

const runner = join(CHECKOUT, "src", "quality", "browser", "browser.ts");

async function oneRouteSite(): Promise<string> {
  const site = await browserSite({ "checks.config.ts": declaration({ checks: ["html"] }), "dist/index.html": page('<a href="/">home</a>') });
  return site.dir;
}

test("a shard left with no route checks no page and passes instead of failing as an empty declaration", async () => {
  const dir = await oneRouteSite();
  const result = await ran($`bun ${runner} --shard=2/2`.cwd(dir));
  expect(result.text).toContain("browser: shard 2 of 2 checks no route");
  expect(result.text).toContain("browser: this shard holds no check, so no page was checked");
  expect(result.text).not.toContain("the declaration leaves no check to run");
  expect(result.exitCode).toBe(0);
}, 60_000);

test("a shard index past the count is refused as usage instead of running every route", async () => {
  const dir = await oneRouteSite();
  const result = await ran($`bun ${runner} --shard=3/2`.cwd(dir));
  expect(result.text).toContain("usage: browser [--pr] [--shard=<index>/<count>] [<directory>]");
  expect(result.exitCode).toBe(2);
}, 60_000);
