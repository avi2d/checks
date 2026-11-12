import { expect, test } from "bun:test";
import { at, browserSite, declaration, failuresOf, page, routesOf, sitePages } from "../e2e/lib/browser-site.ts";

test("assets is red on an image the site does not serve and on a request that fails, and green once both load", async () => {
  const pictured = (src: string): string => page(`<p><a href="/">Write to me</a></p><img src="${src}" alt="The owner" width="10" height="10">`);
  const site = await browserSite({
    "dist/index.html": pictured("/portrait.svg"),
    "dist/refused.html": pictured("http://127.0.0.1:1/portrait.svg"),
    "browser-checks.json": declaration({ routes: [{ path: "/", locale: "en" }, { path: "/refused.html", locale: "en" }], checks: ["assets"] }),
  });
  const failed = await site.run();
  const origin = /(http:\/\/127\.0\.0\.1:\d+)\/portrait\.svg answers 404/.exec(failed.text)?.[1];
  expect(failuresOf(failed.text).toSorted()).toEqual([
    `${at("assets", "/")} ${origin}/portrait.svg answers 404`,
    `${at("assets", "/")} logs the error: Failed to load resource: the server responded with a status of 404 (Not Found)`,
    `${at("assets", "/refused.html")} http://127.0.0.1:1/portrait.svg fails to load: net::ERR_UNSAFE_PORT`,
    `${at("assets", "/refused.html")} logs the error: Failed to load resource: net::ERR_UNSAFE_PORT`,
    `${at("assets", "/refused.html")} requests another origin: http://127.0.0.1:1/portrait.svg`,
  ]);
  expect(failed.exitCode).toBe(1);

  await site.write({ "dist/portrait.svg": `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>`, "dist/refused.html": pictured("/portrait.svg") });
  const passed = await site.run();
  expect(passed.text).toContain("browser: assets at / (en), phone 320x640, default scanned 2 request(s)");
  expect(passed.exitCode).toBe(0);
}, 120_000);

test("assets is red on a console error, an uncaught error and a script from another origin, and green once each is fixed", async () => {
  const WIDGET = `document.querySelector("main").dataset.widget = "ready";`;
  using outside = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response(WIDGET, { headers: { "content-type": "text/javascript" } }) });
  const red = {
    "logged.html": page(`<p><a href="/">Write to me</a></p><script>console.error("the form never started")</script>`),
    "thrown.html": page(`<p><a href="/">Write to me</a></p><script>throw new Error("the menu never opened")</script>`),
    "outside.html": page(`<p><a href="/">Write to me</a></p><script src="${outside.url.origin}/widget.js"></script>`),
  };
  const site = await browserSite({ ...sitePages(red), "browser-checks.json": declaration({ routes: routesOf(red), checks: ["assets"] }) });
  const failed = await site.run();
  expect(failuresOf(failed.text)).toEqual([
    `${at("assets", "/logged.html")} logs the error: the form never started`,
    `${at("assets", "/thrown.html")} throws an uncaught Error: the menu never opened`,
    `${at("assets", "/outside.html")} requests another origin: ${outside.url.origin}/widget.js`,
  ]);
  expect(failed.exitCode).toBe(1);

  await site.write({
    ...sitePages(Object.fromEntries(Object.keys(red).map((path) => [path, page(`<p><a href="/">Write to me</a></p><script src="/widget.js"></script>`)]))),
    "dist/widget.js": WIDGET,
  });
  const passed = await site.run();
  expect(passed.text).toContain(`browser: ${at("assets", "/outside.html").slice(0, -1)} scanned 2 request(s)`);
  expect(failuresOf(passed.text)).toEqual([]);
  expect(passed.exitCode).toBe(0);
}, 120_000);
