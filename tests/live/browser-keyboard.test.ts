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
