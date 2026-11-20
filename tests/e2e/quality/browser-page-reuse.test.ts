import { expect, test } from "bun:test";
import { at, browserSite, declaration, failuresOf, page, type Declared } from "../lib/browser-site.ts";

async function observeLoads(config: Declared) {
  const loads: string[] = [];
  const probe = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      loads.push(new URL(request.url).search.slice(1));
      return new Response(null, { headers: { "access-control-allow-origin": "*", "cache-control": "no-store" } });
    },
  });
  const probeUrl = new URL("/load", probe.url).href;
  try {
    const html = page(`<a href="/">Home</a><script>
      const loadNumber = Number(localStorage.getItem("loads")) + 1;
      localStorage.setItem("loads", String(loadNumber));
      const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      const request = new XMLHttpRequest();
      request.open("GET", "${probeUrl}?" + [location.pathname, innerWidth, reduced, loadNumber].join(","), false);
      request.send();
    </script>`, { head: '<link rel="icon" href="data:,">' });
    const site = await browserSite({
      "dist/index.html": html,
      "dist/other.html": html,
      "checks.config.ts": declaration(config),
    });
    const result = await site.run();
    return { ...result, loads: loads.toSorted(), probeUrl };
  } finally {
    await probe.stop();
  }
}

test("target discovery and nesting do not open separate pages within a visit or reuse a page across visits", async () => {
  const result = await observeLoads({
    routes: [{ path: "/", locale: "en" }, { path: "/other.html", locale: "en" }],
    viewports: [{ name: "phone", width: 320, height: 640 }, { name: "wide", width: 800, height: 640 }],
    states: [{ name: "default" }, { name: "reduced", reducedMotion: "reduce" }],
    checks: ["nesting"],
  });
  expect(result.text).toContain("16 check run(s) over 2 route(s), 2 viewport(s), 2 state(s) and 1 target(s) pass");
  expect(result.exitCode).toBe(0);
  expect(result.loads).toEqual([
    "/,320,false,1",
    "/,320,true,1",
    "/,800,false,1",
    "/,800,true,1",
    "/other.html,320,false,1",
    "/other.html,320,true,1",
    "/other.html,800,false,1",
    "/other.html,800,true,1",
  ]);
}, 120_000);

test("keyboard does not use the shared page or move nesting ahead of it in the report", async () => {
  const result = await observeLoads({ checks: ["keyboard", "nesting"] });
  expect(result.exitCode).toBe(0);
  expect([...result.text.matchAll(/^browser: (\w+) at /gm)].map(([, check]) => check)).toEqual(["targets", "keyboard", "nesting"]);
  expect(result.loads).toEqual(["/,320,false,1", "/,320,false,1"]);
}, 120_000);

test("assets does not reuse the loaded page and miss a request made during load", async () => {
  const result = await observeLoads({ checks: ["nesting", "assets"] });
  expect(result.exitCode).toBe(1);
  expect(failuresOf(result.text)).toEqual([`${at("assets", "/")} requests another origin: ${result.probeUrl}?/,320,false,1`]);
  expect(result.loads).toEqual(["/,320,false,1", "/,320,false,1"]);
}, 120_000);
