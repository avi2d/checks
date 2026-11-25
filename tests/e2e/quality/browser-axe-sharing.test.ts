import { $ } from "bun";
import { expect, test } from "bun:test";
import { symlink } from "node:fs/promises";
import { join } from "node:path";
import { browserSite, declaration, failuresOf, page, routesOf, sitePages } from "../lib/browser-site.ts";
import { CHECKOUT, ran, scratchDirs } from "../lib/fixture-repo.ts";

const scratch = scratchDirs();
const runner = "src/quality/browser/browser.ts";

async function baseRunner(base: string): Promise<string> {
  const dir = await scratch("checks-browser-base-");
  const revision = (await $`git -C ${CHECKOUT} merge-base HEAD ${"refs/remotes/origin/" + base}`.text()).trim();
  await $`git -C ${CHECKOUT} archive ${revision} src | tar -x -C ${dir}`.quiet();
  await symlink(join(CHECKOUT, "node_modules"), join(dir, "node_modules"));
  return join(dir, runner);
}

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
    const measure = async (label: string, bin: string) => {
      const start = performance.now();
      const result = await ran($`bun ${bin}`.cwd(site.dir));
      console.log(`browser fixture ${label}: ${Math.round(performance.now() - start)}ms wall, ${loads} page loads, ${failuresOf(result.text).length} findings`);
      return result;
    };
    const base = process.env["GITHUB_BASE_REF"];
    if (base) {
      const before = await measure("base", await baseRunner(base));
      expect(before.exitCode).toBe(1);
      loads = 0;
    }
    const head = await measure("head", join(CHECKOUT, runner));
    expect(head.exitCode).toBe(1);
    expect(loads).toBe(8);
    const failures = failuresOf(head.text);
    expect(failures).toHaveLength(16);
    for (const id of ["first", "second"]) {
      expect(failures.filter((one) => one.includes(`button-name (critical): #${id}:`))).toHaveLength(8);
    }
  } finally {
    await probe.stop(true);
  }
}, 120_000);
