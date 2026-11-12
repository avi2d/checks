import { expect, test } from "bun:test";
import { at, browserSite, declaration, failuresOf, page, routesOf, sitePages } from "../e2e/lib/browser-site.ts";

test("links is red on a dead fragment on a noindex page, a fragment no element on its page names and a page the site does not serve, and green once each points somewhere", async () => {
  const NOINDEX = '<meta name="robots" content="noindex, nofollow">';
  const passing = page(
    [
      '<h2 id="sooner">Sooner</h2><h2 id="услуги">Services</h2>',
      '<p><a href="/other.html">Other</a> <a href="#top">Top</a> <a href="#%D1%83%D1%81%D0%BB%D1%83%D0%B3%D0%B8">Services</a></p>',
      '<p><a href="/dir#here">Folder</a> <a href="https://example.com/#nowhere">Elsewhere</a> <a href="mailto:wren@example.com">Mail</a></p>',
    ].join(""),
  );
  const pages = {
    "target.html": passing,
    "dir/index.html": page('<p id="here"><a href="/target.html#sooner">Back</a></p>'),
  };
  const red = {
    "noindex.html": page('<p><a href="#nowhere">Jump</a></p>', { head: NOINDEX }),
    "other.html": page('<p><a href="/target.html#later">Later</a> <a href="/gone/">Gone</a></p>'),
  };
  const site = await browserSite({
    ...sitePages({ ...pages, ...red }),
    "browser-checks.json": declaration({
      routes: routesOf({ ...pages, ...red }),
      checks: ["links"],
      viewports: [{ name: "phone", width: 320, height: 640 }, { name: "tablet", width: 820, height: 1180 }],
      states: [{ name: "default" }, { name: "alt" }],
    }),
  });
  const failed = await site.run();
  expect(failuresOf(failed.text).filter((line) => !line.startsWith("targets at")).toSorted()).toEqual([
    `${at("links", "/noindex.html")} /noindex.html#nowhere names no element on its page`,
    `${at("links", "/other.html")} /gone/ answers 404`,
    `${at("links", "/other.html")} /target.html#later names no element on its page`,
  ]);
  expect(failed.exitCode).toBe(1);

  await site.write(
    sitePages({
      "noindex.html": page('<p id="somewhere"><a href="#somewhere">Jump</a></p>', { head: NOINDEX }),
      "other.html": page('<p><a href="/target.html#sooner">Sooner</a> <a href="/dir/">Folder</a></p>'),
    }),
  );
  const passed = await site.run();
  expect(passed.text).toContain(`browser: ${at("links", "/target.html").slice(0, -1)} scanned 4 same-site link(s)`);
  expect(passed.text.split("\n").filter((line) => line.startsWith("browser: links at"))).toHaveLength(4);
  expect(failuresOf(passed.text)).toEqual([]);
  expect(passed.exitCode).toBe(0);
}, 120_000);
