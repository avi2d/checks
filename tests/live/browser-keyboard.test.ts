import { expect, test } from "bun:test";
import { chromium } from "playwright-core";
import { elementPath, RESOLVE_LEAF, type PageElement } from "../../src/quality/browser/keyboard-page.ts";
import { at, browserSite, declaration, failuresOf, page, routesOf, sitePages } from "../e2e/lib/browser-site.ts";

const COMPACT_BAR = `<script>addEventListener("scroll", () => { document.querySelector(".bar").hidden = scrollY < 200; });</script>`;

test("keyboard reads a distinct path for each of two Tab stops, including one inside a shadow root", async () => {
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" });
  try {
    const tab = await (await browser.newContext()).newPage();
    await tab.setContent(page(
      `<a href="/">Services</a><search-box></search-box><script>class SearchBox extends HTMLElement { constructor() { super(); this.attachShadow({ mode: "open" }).innerHTML = "<input aria-label=Search>"; } } customElements.define("search-box", SearchBox);</script>`,
    ));
    const nextPath = async () => {
      await tab.keyboard.press("Tab");
      return (await tab.evaluateHandle<PageElement>(RESOLVE_LEAF)).asElement()?.evaluate(elementPath);
    };
    expect([await nextPath(), await nextPath()]).toEqual(["html:0/body:1/main:0/a:0", "html:0/body:1/main:0/search-box:1/shadow/input:0"]);
  } finally {
    await browser.close();
  }
}, 120_000);

test("keyboard scans every one of two Tab stops on a target", async () => {
  const site = await browserSite({
    "dist/index.html": page(`<a href="/">Services</a><a href="/">Contacts</a>`, { head: `<style>a:focus { outline: 3px solid #000; }</style>` }),
    "checks.config.ts": declaration({ checks: ["keyboard"] }),
  });
  const ran = await site.run();
  expect(failuresOf(ran.text)).toEqual([]);
  expect(ran.text).toContain(`browser: ${at("keyboard", "/").slice(0, -1)} scanned link 2`);
  expect(ran.exitCode).toBe(0);
}, 120_000);

test("keyboard judges a menu on the items visible before the first Tab press, not on the items a compact bar shows once Tab scrolls the page", async () => {
  const site = await browserSite({
    "dist/index.html": page(
      `<nav class="bar" hidden style="position: fixed; top: 0"><a href="/">Call</a></nav><nav><a href="/">Services</a></nav><div style="height: 3000px"></div><p><a href="/">Write to me</a></p>${COMPACT_BAR}`,
    ),
    "checks.config.ts": declaration({ targets: [{ name: "menu", selector: "nav a", focusable: true }], checks: ["keyboard"] }),
  });
  const ran = await site.run();
  expect(failuresOf(ran.text)).toEqual([]);
  expect(ran.text).toContain(`browser: ${at("keyboard", "/").slice(0, -1)} scanned menu 1`);
  expect(ran.exitCode).toBe(0);
}, 120_000);

test("keyboard counts a focus ring drawn on the row far outside the link as visible focus, and still fails a lit row that does not change on focus", async () => {
  const row = (ring: string) =>
    page(`<ul style="list-style: none; padding: 0"><li class="row" style="padding: 40px; background: #eef"><a href="/">Family law</a></li></ul>`, {
      head: `<style>a:focus { outline: none; } ${ring}</style>`,
    });
  const pages = {
    "row-ring.html": row(".row:focus-within { outline: 3px solid #000; outline-offset: -4px; }"),
    "lit-row.html": row(""),
  };
  const site = await browserSite({
    ...sitePages(pages),
    "checks.config.ts": declaration({ routes: routesOf(pages), viewports: [{ name: "phone", width: 320, height: 640, touch: true }], checks: ["keyboard"] }),
  });
  const ran = await site.run();
  expect(failuresOf(ran.text)).toEqual([`${at("keyboard", "/lit-row.html", "default", "phone 320x640 touch")} link shows no visible focus when Tab reaches it`]);
  expect(ran.text).toContain(`browser: ${at("keyboard", "/row-ring.html", "default", "phone 320x640 touch").slice(0, -1)} scanned link 1`);
  expect(ran.exitCode).toBe(1);
}, 120_000);

test("keyboard counts a row ring at any nesting depth, and still fails a distant message that blur shows", async () => {
  const nestedRing = page(
    `<ul style="list-style: none; padding: 0"><li class="row" style="padding: 40px; background: #eef"><span><a href="/">Family law</a></span></li></ul>`,
    { head: `<style>a:focus { outline: none; } .row:focus-within { outline: 3px solid #000; outline-offset: -4px; }</style>` },
  );
  const tallForm = page(
    `<form><input name="name"><div style="height: 200px"></div><p class="msg">Complete every field</p></form>`,
    { head: `<style>input:focus { outline: none; } form:focus-within .msg { display: none; }</style>` },
  );
  const pages = { "nested-ring.html": nestedRing, "tall-form.html": tallForm };
  const site = await browserSite({
    ...sitePages(pages),
    "checks.config.ts": declaration({
      routes: routesOf(pages),
      viewports: [{ name: "phone", width: 320, height: 640, touch: true }],
      targets: [
        { name: "link", selector: "main a", routes: ["/nested-ring.html"], focusable: true },
        { name: "field", selector: "input", routes: ["/tall-form.html"], focusable: true },
      ],
      checks: ["keyboard"],
    }),
  });
  const ran = await site.run();
  expect(failuresOf(ran.text)).toEqual([`${at("keyboard", "/tall-form.html", "default", "phone 320x640 touch")} field shows no visible focus when Tab reaches it`]);
  expect(ran.text).toContain(`browser: ${at("keyboard", "/nested-ring.html", "default", "phone 320x640 touch").slice(0, -1)} scanned link 1`);
  expect(ran.exitCode).toBe(1);
}, 120_000);

test("keyboard counts a row ring drawn by a pseudo-element or a large outline offset", async () => {
  const paint = (ring: string) =>
    page(`<ul style="list-style: none; padding: 0"><li class="row" style="position: relative; padding: 40px; background: #eef"><a href="/">Family law</a></li></ul>`, {
      head: `<style>a:focus { outline: none; } ${ring}</style>`,
    });
  const pages = {
    "pseudo-ring.html": paint(`.row::after { content: ""; position: absolute; inset: 0; } .row:focus-within::after { outline: 3px solid #000; }`),
    "offset-ring.html": paint(`.row:focus-within { outline: 3px solid #000; outline-offset: 12px; }`),
  };
  const site = await browserSite({
    ...sitePages(pages),
    "checks.config.ts": declaration({ routes: routesOf(pages), viewports: [{ name: "phone", width: 320, height: 640, touch: true }], checks: ["keyboard"] }),
  });
  const ran = await site.run();
  expect(failuresOf(ran.text)).toEqual([]);
  expect(ran.text).toContain(`browser: ${at("keyboard", "/pseudo-ring.html", "default", "phone 320x640 touch").slice(0, -1)} scanned link 1`);
  expect(ran.text).toContain(`browser: ${at("keyboard", "/offset-ring.html", "default", "phone 320x640 touch").slice(0, -1)} scanned link 1`);
  expect(ran.exitCode).toBe(0);
}, 120_000);

test("keyboard counts a ring the link draws with its own focus-visible pseudo-element outside its box, and still fails a link with no focus indication", async () => {
  const row = (ring: string) =>
    page(`<ul style="list-style: none; padding: 0 24px"><li class="row" style="position: relative; padding: 40px 0"><h3 style="margin: 0"><a href="/">Family law</a></h3></li></ul>`, {
      head: `<style>a { color: inherit; text-decoration: none; } a:focus-visible { outline: none; } ${ring}</style>`,
    });
  const pages = {
    "before-ring.html": row(`a:focus-visible::before { content: ""; position: absolute; inset: 8px -16px; outline: 2px solid #000; }`),
    "after-ring.html": row(`a:focus-visible::after { content: ""; position: absolute; inset: 8px -16px; border: 2px solid #000; }`),
    "no-ring.html": row(""),
  };
  const site = await browserSite({
    ...sitePages(pages),
    "checks.config.ts": declaration({ routes: routesOf(pages), viewports: [{ name: "phone", width: 320, height: 640, touch: true }], checks: ["keyboard"] }),
  });
  const ran = await site.run();
  expect(failuresOf(ran.text)).toEqual([`${at("keyboard", "/no-ring.html", "default", "phone 320x640 touch")} link shows no visible focus when Tab reaches it`]);
  expect(ran.text).toContain(`browser: ${at("keyboard", "/before-ring.html", "default", "phone 320x640 touch").slice(0, -1)} scanned link 1`);
  expect(ran.text).toContain(`browser: ${at("keyboard", "/after-ring.html", "default", "phone 320x640 touch").slice(0, -1)} scanned link 1`);
  expect(ran.exitCode).toBe(1);
}, 120_000);

test("keyboard does not count paint added by the field's blur handler as focus", async () => {
  const site = await browserSite({
    "dist/index.html": page(
      `<input name="name"><script>document.querySelector("input").addEventListener("blur", (event) => event.target.classList.add("touched"));</script>`,
      { head: `<style>input:focus { outline: none; } input.touched { background: red; }</style>` },
    ),
    "checks.config.ts": declaration({ targets: [{ name: "field", selector: "input", focusable: true }], checks: ["keyboard"] }),
  });
  const ran = await site.run();
  expect(failuresOf(ran.text)).toEqual([`${at("keyboard", "/")} field shows no visible focus when Tab reaches it`]);
  expect(ran.exitCode).toBe(1);
}, 120_000);

test("keyboard does not count paint a previous field adds on blur to the next field", async () => {
  const site = await browserSite({
    "dist/index.html": page(
      `<input id="first"><input id="next"><script>document.querySelector("#first").addEventListener("blur", () => document.querySelector("#next").classList.add("touched"));</script>`,
      { head: `<style>input:focus { outline: none; } #next.touched { background: red; }</style>` },
    ),
    "checks.config.ts": declaration({ targets: [{ name: "next field", selector: "#next", focusable: true }], checks: ["keyboard"] }),
  });
  const ran = await site.run();
  expect(failuresOf(ran.text)).toEqual([`${at("keyboard", "/")} next field shows no visible focus when Tab reaches it`]);
  expect(ran.exitCode).toBe(1);
}, 120_000);

test("keyboard does not count horizontal container scrolling as visible focus", async () => {
  const site = await browserSite({
    "dist/index.html": page(
      `<nav><a href="/" style="background: blue">First</a><a id="offscreen" href="/" style="background: red">Next</a></nav>`,
      { head: `<style>nav { width: 240px; overflow-x: auto; white-space: nowrap; } a { display: inline-block; width: 240px; height: 40px; } a:focus { outline: none; }</style>` },
    ),
    "checks.config.ts": declaration({ targets: [{ name: "offscreen link", selector: "#offscreen", focusable: true }], checks: ["keyboard"] }),
  });
  const ran = await site.run();
  expect(failuresOf(ran.text)).toEqual([`${at("keyboard", "/")} offscreen link shows no visible focus when Tab reaches it`]);
  expect(ran.exitCode).toBe(1);
}, 120_000);

test("keyboard fails a scrolled sticky stop with no focus indication and still checks later targets", async () => {
  const site = await browserSite({
    "dist/index.html": page(
      `<div style="height: 1600px"></div><nav style="position: sticky; top: 0"><a id="sticky" href="/">Sticky</a></nav><a id="later" href="/">Later</a>`,
      { head: `<style>#sticky:focus { outline: none; } #later:focus { outline: 3px solid black; }</style>` },
    ),
    "checks.config.ts": declaration({
      targets: [
        { name: "sticky link", selector: "#sticky", focusable: true },
        { name: "later link", selector: "#later", focusable: true },
      ],
      viewports: [{ name: "phone", width: 320, height: 640, touch: true }],
      checks: ["keyboard"],
    }),
  });
  const ran = await site.run();
  expect(failuresOf(ran.text)).toEqual([`${at("keyboard", "/", "default", "phone 320x640 touch")} sticky link shows no visible focus when Tab reaches it`]);
  expect(ran.text).toContain("scanned sticky link 1, later link 1");
  expect(ran.exitCode).toBe(1);
}, 120_000);

test("keyboard reports a scrolled sticky ring as not measured rather than crediting blur paint", async () => {
  const site = await browserSite({
    "dist/index.html": page(
      `<div style="height: 1600px"></div><nav style="position: sticky; top: 0"><a id="sticky" href="/">Sticky</a></nav>`,
      { head: `<style>#sticky:focus { outline: 3px solid black; }</style>` },
    ),
    "checks.config.ts": declaration({
      targets: [{ name: "sticky link", selector: "#sticky", focusable: true }],
      viewports: [{ name: "phone", width: 320, height: 640, touch: true }],
      checks: ["keyboard"],
    }),
  });
  const ran = await site.run();
  expect(failuresOf(ran.text)).toEqual([]);
  expect(ran.text).toContain("sticky link: Tab scrolled a sticky element, not measured");
  expect(ran.exitCode).toBe(0);
}, 120_000);

test("keyboard reports changed and shortened Tab orders as unmeasured, not unreachable targets or page defects", async () => {
  const changingPage = (change: string) => page(
    `<a id="first" href="/">First</a><button>Middle</button><a id="footer" href="/">Footer</a>
    <script>
      const loaded = sessionStorage.getItem(location.pathname);
      sessionStorage.setItem(location.pathname, "loaded");
      if (loaded) { ${change} }
    </script>`,
  );
  const pages = {
    "changed-first.html": changingPage(`document.querySelector("main").prepend(document.createElement("button"));`),
    "changed-later.html": changingPage(`document.querySelector("button").remove();`),
    "shortened.html": changingPage(`document.querySelector("button").tabIndex = -1; document.querySelector("#footer").tabIndex = -1;`),
    "extended.html": changingPage(`document.querySelector("main").append(document.createElement("button"));`),
  };
  const site = await browserSite({
    ...sitePages(pages),
    "checks.config.ts": declaration({
      routes: routesOf(pages),
      targets: [
        { name: "first", selector: "#first", focusable: true },
        { name: "footer", selector: "#footer", focusable: true },
      ],
      checks: ["keyboard"],
    }),
  });
  const ran = await site.run();
  expect(failuresOf(ran.text)).toEqual([]);
  for (const path of Object.keys(pages)) {
    const prefix = `browser: ${at("keyboard", "/" + path).slice(0, -1)} scanned `;
    const measured = path === "changed-first.html" ? "" : path === "extended.html" ? "first 1, footer 1, " : "first 1, ";
    expect(ran.text).toContain(prefix + measured + "Tab order differed from the reference pass, not measured");
  }
  expect(ran.exitCode).toBe(0);
}, 120_000);

test("keyboard still fails a ring that appears only after blur", async () => {
  const site = await browserSite({
    "dist/index.html": page(
      `<form><input name="name"><script>document.querySelector("input").addEventListener("blur", (event) => event.target.classList.add("touched"));</script></form>`,
      { head: `<style>input:focus { outline: none; } input.touched:focus { outline: 3px solid #000; }</style>` },
    ),
    "checks.config.ts": declaration({ targets: [{ name: "field", selector: "input", focusable: true }], checks: ["keyboard"] }),
  });
  const ran = await site.run();
  expect(failuresOf(ran.text)).toEqual([`${at("keyboard", "/")} field shows no visible focus when Tab reaches it`]);
  expect(ran.exitCode).toBe(1);
}, 120_000);

test("keyboard does not credit a cloned control for the original it copied", async () => {
  const site = await browserSite({
    "dist/index.html": page(
      `<nav inert><a href="/">Services</a></nav><div style="height: 3000px"></div><p><button type="button">Write to me</button></p><script>document.querySelector("button").addEventListener("focus", () => { if (document.querySelector(".clone")) return; const bar = document.createElement("nav"); bar.className = "clone"; bar.append(document.querySelector("nav a").cloneNode(true)); document.body.append(bar); });</script>`,
    ),
    "checks.config.ts": declaration({ targets: [{ name: "menu", selector: "nav a", focusable: true }], checks: ["keyboard"] }),
  });
  const ran = await site.run();
  expect(failuresOf(ran.text)).toEqual([
    `${at("keyboard", "/")} Tab reached menu 0 of 1 time(s)`,
    `${at("keyboard", "/")} scanned no target`,
  ]);
  expect(ran.exitCode).toBe(1);
}, 120_000);

test("keyboard still fails a touched row whose ring needs refocus to appear", async () => {
  const site = await browserSite({
    "dist/index.html": page(
      `<ul style="list-style: none; padding: 0"><li class="row" style="padding: 40px"><input name="name"><script>document.querySelector("input").addEventListener("blur", (event) => event.target.closest(".row").classList.add("touched"));</script></li></ul>`,
      { head: `<style>input:focus { outline: none; } .row.touched:focus-within { outline: 3px solid #000; }</style>` },
    ),
    "checks.config.ts": declaration({ targets: [{ name: "field", selector: "input", focusable: true }], checks: ["keyboard"] }),
  });
  const ran = await site.run();
  expect(failuresOf(ran.text)).toEqual([`${at("keyboard", "/")} field shows no visible focus when Tab reaches it`]);
  expect(ran.exitCode).toBe(1);
}, 120_000);

test("keyboard still fails a distant message in a shadowed card with a transparent outline", async () => {
  const site = await browserSite({
    "dist/index.html": page(
      `<div class="card" style="box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2); padding: 24px"><form><input name="name"><div style="height: 200px"></div><p class="msg">Complete every field</p></form></div>`,
      { head: `<style>input:focus { outline: 3px solid transparent; } form:focus-within .msg { display: none; }</style>` },
    ),
    "checks.config.ts": declaration({ targets: [{ name: "field", selector: "input", focusable: true }], checks: ["keyboard"] }),
  });
  const ran = await site.run();
  expect(failuresOf(ran.text)).toEqual([`${at("keyboard", "/")} field shows no visible focus when Tab reaches it`]);
  expect(ran.exitCode).toBe(1);
}, 120_000);

test("keyboard counts an underline drawn inside the link as visible focus", async () => {
  const site = await browserSite({
    "dist/index.html": page(`<p><a href="/">Family law</a></p>`, { head: `<style>a { text-decoration: none; outline-offset: 0; } a:focus { outline: none; outline-offset: 0; text-decoration: underline; }</style>` }),
    "checks.config.ts": declaration({ targets: [{ name: "link", selector: "main a", focusable: true }], checks: ["keyboard"] }),
  });
  const ran = await site.run();
  expect(failuresOf(ran.text)).toEqual([]);
  expect(ran.text).toContain(`browser: ${at("keyboard", "/").slice(0, -1)} scanned link 1`);
  expect(ran.exitCode).toBe(0);
}, 120_000);

test("keyboard walks past a shadow-root search into the declared menu", async () => {
  const site = await browserSite({
    "dist/index.html": page(
      `<search-box></search-box><nav><a href="/">Services</a></nav><script>class SearchBox extends HTMLElement { constructor() { super(); const root = this.attachShadow({ mode: "open", delegatesFocus: true }); root.innerHTML = "<input type=search aria-label=Search>"; } } customElements.define("search-box", SearchBox);</script>`,
    ),
    "checks.config.ts": declaration({ targets: [{ name: "menu", selector: "nav a", focusable: true }], checks: ["keyboard"] }),
  });
  const ran = await site.run();
  expect(failuresOf(ran.text)).toEqual([]);
  expect(ran.text).toContain(`browser: ${at("keyboard", "/").slice(0, -1)} scanned menu 1`);
  expect(ran.exitCode).toBe(0);
}, 120_000);

test("keyboard counts a bolder label with no outline as visible focus", async () => {
  const site = await browserSite({
    "dist/index.html": page(`<p><a href="/">Family law</a></p>`, { head: `<style>a { font-weight: 400; } a:focus { outline: none; font-weight: 700; }</style>` }),
    "checks.config.ts": declaration({ targets: [{ name: "link", selector: "main a", focusable: true }], checks: ["keyboard"] }),
  });
  const ran = await site.run();
  expect(failuresOf(ran.text)).toEqual([]);
  expect(ran.text).toContain(`browser: ${at("keyboard", "/").slice(0, -1)} scanned link 1`);
  expect(ran.exitCode).toBe(0);
}, 120_000);

test("keyboard counts a shadow drawn left of the row as visible focus", async () => {
  const site = await browserSite({
    "dist/index.html": page(
      `<ul style="list-style: none; padding: 0"><li class="row" style="margin-left: 40px; padding: 20px"><a href="/">Family law</a></li></ul>`,
      { head: `<style>a:focus { outline: none; } .row:focus-within { box-shadow: -12px 0 0 #000; }</style>` },
    ),
    "checks.config.ts": declaration({ targets: [{ name: "link", selector: "main a", focusable: true }], checks: ["keyboard"] }),
  });
  const ran = await site.run();
  expect(failuresOf(ran.text)).toEqual([]);
  expect(ran.text).toContain(`browser: ${at("keyboard", "/").slice(0, -1)} scanned link 1`);
  expect(ran.exitCode).toBe(0);
}, 120_000);

const checkFixture = async (file: string, labels: readonly string[], withoutFocus: readonly string[]) => {
  const html = await Bun.file(new URL("../fixtures/keyboard/" + file, import.meta.url)).text();
  const site = await browserSite({
    "dist/index.html": html,
    "checks.config.ts": declaration({
      targets: labels.map((name) => ({ name, selector: "#" + name, focusable: true })),
      checks: ["keyboard"],
    }),
  });
  const ran = await site.run();
  expect(failuresOf(ran.text)).toEqual(withoutFocus.map((name) => `${at("keyboard", "/")} ${name} shows no visible focus when Tab reaches it`));
  const scanned = labels.map((name) => `${name} 1`).join(", ");
  expect(ran.text).toContain(`browser: ${at("keyboard", "/").slice(0, -1)} scanned ${scanned}`);
  expect(ran.exitCode).toBe(withoutFocus.length === 0 ? 0 : 1);
};

test("keyboard does not count a distant message inside a transparently outlined form", () => checkFixture("distant-message.html", ["link", "field"], ["field"]), 60_000);

test("keyboard does not cut off sized before and after rings or a large outline offset", () => checkFixture("row-rings.html", ["before", "after", "offset"], []), 60_000);

test("keyboard does not reject wrapper rings managed by direct or delegated focus handlers", () => checkFixture("js-focus-ring.html", ["direct", "delegated"], []), 60_000);
