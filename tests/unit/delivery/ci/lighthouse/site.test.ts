import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Effect, Exit, Option } from "effect";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { answer, auditOrigin, choosePages, pagesOf, routesOf } from "../../../../../src/delivery/ci/lighthouse/site.ts";

describe("pagesOf", () => {
  test("a page list that keeps index.html in the address, takes files other than .html, or comes out unsorted fails", () => {
    const files = ["index.html", "about/index.html", "news/2026.html", "styles.css", "img/hero.webp", "404.html"];
    expect(pagesOf(files)).toEqual(["/", "/404.html", "/about/", "/news/2026.html"]);
  });

  test("a site of assets alone that still names a page fails", () => {
    expect(pagesOf(["styles.css", "robots.txt"])).toEqual([]);
  });
});

describe("choosePages", () => {
  const found = ["/", "/about/"];

  test("an empty pages input that audits less than every page fails", () => {
    expect(Effect.runSync(choosePages(found, "  "))).toEqual(found);
  });

  test("a pages input that is not split on whitespace, or that audits a named page twice, fails", () => {
    expect(Effect.runSync(choosePages(found, "/about/\n/  /about/"))).toEqual(["/about/", "/"]);
  });

  test("a named page the site does not hold that passes, or whose message omits it, fails", () => {
    const failure = Effect.runSync(Effect.flip(choosePages(found, "/ /contact/")));
    expect(failure.message).toContain("/contact/");
  });

  test("a site with no page that passes fails", () => {
    expect(Exit.isFailure(Effect.runSyncExit(choosePages([], "")))).toBe(true);
  });
});

describe("auditOrigin", () => {
  test("an empty origin that audits anything but the local copy fails", () => {
    expect(Option.isNone(Effect.runSync(auditOrigin("")))).toBe(true);
  });

  test("a live origin that keeps a path, or that comes back without the slash the local origin ends in, fails", () => {
    expect(Effect.runSync(auditOrigin("https://azalialaw.com"))).toEqual(Option.some("https://azalialaw.com/"));
    expect(Effect.runSync(auditOrigin("https://azalialaw.com/about/"))).toEqual(Option.some("https://azalialaw.com/"));
  });

  test("a plain http origin that passes fails", () => {
    expect(Exit.isFailure(Effect.runSyncExit(auditOrigin("http://azalialaw.com")))).toBe(true);
  });
});

describe("answer", () => {
  let root = "";

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "lighthouse-site-"));
    mkdirSync(join(root, "about"));
    writeFileSync(join(root, "index.html"), "home");
    writeFileSync(join(root, "about", "index.html"), "about");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const routes = routesOf(["index.html", "about/index.html"]);
  const get = (path: string) => answer(root, routes, new Request(`http://127.0.0.1:1${path}`));

  test("a folder address that does not serve its index.html fails", async () => {
    expect(await get("/about/").text()).toBe("about");
    expect(await get("/").text()).toBe("home");
  });

  test("an address the site does not hold that answers other than 404 fails", () => {
    expect(get("/missing.png").status).toBe(404);
  });
});
