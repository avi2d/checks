import { $ } from "bun";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { browserSite, declaration, failuresOf, page, routesOf, sitePages } from "../lib/browser-site.ts";
import { CHECKOUT, ran } from "../lib/fixture-repo.ts";

test("axe reports both unnamed buttons per visit without loading a second copy of the page", async () => {
  let loads = 0;
  const probe = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch() {
      loads += 1;
      return new Response("", { headers: { "content-type": "application/javascript", "cache-control": "no-store" } });
    },
  });
  try {
    const links = Array.from({ length: 32 }, (_, i) => `<li><a href="#item-${i}" id="item-${i}">Item ${i}</a></li>`).join("");
    const html = page(`<h1>Index</h1><ul>${links}</ul><button id="first"></button><button id="second"></button>`, { head: `<script src="${probe.url.href}"></script>` });
    const pages = { "one.html": html, "two.html": html, "three.html": html, "four.html": html };
    const site = await browserSite({
      ...sitePages(pages),
      "checks.config.ts": declaration({
        checks: ["axe", "nesting"], routes: routesOf(pages),
        viewports: [{ name: "phone", width: 375, height: 667 }, { name: "desktop", width: 1440, height: 900 }],
      }),
    });
    const start = performance.now();
    const result = await ran($`bun ${join(CHECKOUT, "src/quality/browser/browser.ts")}`.cwd(site.dir));
    const failures = failuresOf(result.text);
    console.log(`browser fixture: ${Math.round(performance.now() - start)}ms wall, ${loads} page loads, ${failures.length} findings`);
    expect(result.exitCode).toBe(1);
    expect(loads).toBe(8);
    for (const id of ["first", "second"]) {
      expect(failures.filter((one) => one.includes(`button-name (critical): #${id}:`))).toHaveLength(8);
    }
  } finally {
    await probe.stop(true);
  }
}, 120_000);
