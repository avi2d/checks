import { expect, test } from "bun:test";
import { at, browserSite, declaration, failuresOf, page, routesOf, sitePages } from "../e2e/lib/browser-site.ts";

const COMPACT_BAR = `<script>addEventListener("scroll", () => { document.querySelector(".bar").hidden = scrollY < 200; });</script>`;

test("keyboard judges a menu on the items visible before the first Tab press, not on the items a compact bar shows once Tab scrolls the page", async () => {
  const site = await browserSite({
    "dist/index.html": page(
      `<nav class="bar" hidden style="position: fixed; top: 0"><a href="/">Call</a></nav><nav><a href="/">Services</a></nav><div style="height: 3000px"></div><p><a href="/">Write to me</a></p>${COMPACT_BAR}`,
    ),
    "browser-checks.json": declaration({ targets: [{ name: "menu", selector: "nav a", focusable: true }], checks: ["keyboard"] }),
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
    "browser-checks.json": declaration({ routes: routesOf(pages), viewports: [{ name: "phone", width: 320, height: 640, touch: true }], checks: ["keyboard"] }),
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
    "browser-checks.json": declaration({
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
    "browser-checks.json": declaration({ routes: routesOf(pages), viewports: [{ name: "phone", width: 320, height: 640, touch: true }], checks: ["keyboard"] }),
  });
  const ran = await site.run();
  expect(failuresOf(ran.text)).toEqual([]);
  expect(ran.text).toContain(`browser: ${at("keyboard", "/pseudo-ring.html", "default", "phone 320x640 touch").slice(0, -1)} scanned link 1`);
  expect(ran.text).toContain(`browser: ${at("keyboard", "/offset-ring.html", "default", "phone 320x640 touch").slice(0, -1)} scanned link 1`);
  expect(ran.exitCode).toBe(0);
}, 120_000);

test("keyboard still fails a ring that appears only after blur", async () => {
  const site = await browserSite({
    "dist/index.html": page(
      `<form><input name="name"><script>document.querySelector("input").addEventListener("blur", (event) => event.target.classList.add("touched"));</script></form>`,
      { head: `<style>input:focus { outline: none; } input.touched:focus { outline: 3px solid #000; }</style>` },
    ),
    "browser-checks.json": declaration({ targets: [{ name: "field", selector: "input", focusable: true }], checks: ["keyboard"] }),
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
    "browser-checks.json": declaration({ targets: [{ name: "menu", selector: "nav a", focusable: true }], checks: ["keyboard"] }),
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
      { head: `<style>input:focus { outline: none; } .row { background: #fff; } .row.touched { background: #eef; } .row.touched:focus-within { outline: 3px solid #000; }</style>` },
    ),
    "browser-checks.json": declaration({ targets: [{ name: "field", selector: "input", focusable: true }], checks: ["keyboard"] }),
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
    "browser-checks.json": declaration({ targets: [{ name: "field", selector: "input", focusable: true }], checks: ["keyboard"] }),
  });
  const ran = await site.run();
  expect(failuresOf(ran.text)).toEqual([`${at("keyboard", "/")} field shows no visible focus when Tab reaches it`]);
  expect(ran.exitCode).toBe(1);
}, 120_000);

test("keyboard counts an underline drawn inside the link as visible focus", async () => {
  const site = await browserSite({
    "dist/index.html": page(`<p><a href="/">Family law</a></p>`, { head: `<style>a { text-decoration: none; outline-offset: 0; } a:focus { outline: none; outline-offset: 0; text-decoration: underline; }</style>` }),
    "browser-checks.json": declaration({ targets: [{ name: "link", selector: "main a", focusable: true }], checks: ["keyboard"] }),
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
    "browser-checks.json": declaration({ targets: [{ name: "menu", selector: "nav a", focusable: true }], checks: ["keyboard"] }),
  });
  const ran = await site.run();
  expect(failuresOf(ran.text)).toEqual([]);
  expect(ran.text).toContain(`browser: ${at("keyboard", "/").slice(0, -1)} scanned menu 1`);
  expect(ran.exitCode).toBe(0);
}, 120_000);

test("keyboard counts a bolder label with no outline as visible focus", async () => {
  const site = await browserSite({
    "dist/index.html": page(`<p><a href="/">Family law</a></p>`, { head: `<style>a { font-weight: 400; } a:focus { outline: none; font-weight: 700; }</style>` }),
    "browser-checks.json": declaration({ targets: [{ name: "link", selector: "main a", focusable: true }], checks: ["keyboard"] }),
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
    "browser-checks.json": declaration({ targets: [{ name: "link", selector: "main a", focusable: true }], checks: ["keyboard"] }),
  });
  const ran = await site.run();
  expect(failuresOf(ran.text)).toEqual([]);
  expect(ran.text).toContain(`browser: ${at("keyboard", "/").slice(0, -1)} scanned link 1`);
  expect(ran.exitCode).toBe(0);
}, 120_000);
