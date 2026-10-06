import { expect, test } from "bun:test";
import { browserSite, declaration, failuresOf, HOOK_TYPES, page, routesOf } from "./lib/browser-site.ts";

const CLEAN_LINK = page(`<p><a href="/">Write to me</a></p>`);

const at = (check: string, path: string, state = "default", viewport = "phone 320x640"): string => `${check} at ${path} (en), ${viewport}, ${state}:`;

function sitePages(pages: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(pages).map(([path, html]) => [`dist/${path}`, html]));
}

test("layout is red on sideways overflow, a clipped, cut off, covered or hidden label, overlapping targets and a missing or invisible target, and green once each is fixed", async () => {
  const red = {
    "overflow.html": page(`<p><a href="/" style="white-space: nowrap">a label far too long to fit the narrow phone screen</a></p>`),
    "clipped.html": page(`<a href="/" style="display: inline-block; width: 40px; overflow: hidden; white-space: nowrap">Contact the owner</a>`),
    "cut-off.html": page(`<div style="overflow: hidden; height: 20px"><p style="margin: 40px 0 0"><a href="/">Write to me</a></p></div>`),
    "covered.html": page(`<p><a href="/">Write to me</a></p><div style="position: absolute; inset: 0; background: white"></div>`),
    "transparent.html": page(`<p><a href="/" style="color: transparent">Write to me</a></p>`),
    "overlap.html": page(`<a href="/" style="position: absolute; top: 10px; left: 10px">Under</a><a href="/" style="position: absolute; top: 10px; left: 10px; background: white">Over</a>`),
    "missing.html": page("<p>No link here</p>"),
    "invisible.html": page(`<p><a href="/" style="display: none">Write to me</a></p>`),
  };
  const site = await browserSite({ ...sitePages(red), "browser-checks.json": declaration({ routes: routesOf(red), checks: ["layout"] }) });
  const failed = await site.run();
  const failures = failuresOf(failed.text);
  for (const [path, part] of [
    ["/overflow.html", "the page is"],
    ["/overflow.html", "is reachable only by scrolling the page sideways"],
    ["/clipped.html", 'link "Contact the owner" clips its own text'],
    ["/cut-off.html", 'link "Write to me" is cut off by a container that cannot be scrolled'],
    ["/covered.html", 'link "Write to me" is covered or clipped at'],
    ["/transparent.html", 'link "Write to me" hides its text "Write to me"'],
    ["/overlap.html", 'link "Under" overlaps link "Over"'],
    ["/missing.html", "scanned no target"],
    ["/invisible.html", "scanned no target"],
  ] as const) {
    expect(failures.filter((line) => line.startsWith(at("layout", path)) && line.includes(part))).not.toEqual([]);
  }
  for (const path of ["/missing.html", "/invisible.html"]) {
    expect(failures).toContain(`${at("targets", path)} link (main a) matches no visible element`);
  }
  expect(failed.exitCode).toBe(1);

  await site.write(sitePages(Object.fromEntries(Object.keys(red).map((path) => [path, CLEAN_LINK]))));
  const passed = await site.run();
  expect(passed.text).toContain(`browser: ${at("layout", "/overflow.html").slice(0, -1)} scanned link 1`);
  expect(passed.text).toContain(`browser: ${at("targets", "/invisible.html").slice(0, -1)} scanned link 1`);
  expect(passed.text).toContain("browser: 16 check run(s) over 8 route(s), 1 viewport(s), 1 state(s) and 1 target(s) pass");
  expect(passed.exitCode).toBe(0);
}, 120_000);

test("a long Russian action that fits at default text but clips at enlarged text fails only in the enlarged state, and passes once it wraps", async () => {
  const action = (style: string): string =>
    page(`<p><a href="mailto:wren@example.com" style="display: inline-block; ${style}">Написать письмо владельцу</a></p>`, { lang: "ru" });
  const site = await browserSite({
    "dist/ru/index.html": action("width: 260px; white-space: nowrap; overflow: hidden"),
    "browser-checks.json": declaration({
      routes: [{ path: "/ru/", locale: "ru" }],
      viewports: [{ name: "phone", width: 375, height: 812, touch: true }],
      states: [{ name: "default" }, { name: "enlarged text", textPx: 32 }],
      targets: [{ name: "email action", selector: "main a" }],
      checks: ["layout"],
    }),
  });
  const failed = await site.run();
  expect(failuresOf(failed.text)).toEqual(['layout at /ru/ (ru), phone 375x812 touch, enlarged text: email action "Написать письмо владельцу" clips its own text']);
  expect(failed.exitCode).toBe(1);

  await site.write({ "dist/ru/index.html": action("max-width: 100%") });
  const passed = await site.run();
  expect(passed.text).toContain("browser: layout at /ru/ (ru), phone 375x812 touch, enlarged text scanned email action 1");
  expect(passed.exitCode).toBe(0);
}, 120_000);

test("keyboard is red on a hidden focus ring and on a target Tab skips, and green once both are restored", async () => {
  const red = {
    "ringless.html": page(`<p><a href="/">Write to me</a></p>`, { head: "<style>a:focus { outline: none; }</style>" }),
    "skipped.html": page(`<p><a href="/" tabindex="-1">Write to me</a></p>`),
  };
  const site = await browserSite({ ...sitePages(red), "browser-checks.json": declaration({ routes: routesOf(red), checks: ["keyboard"] }) });
  const failed = await site.run();
  expect(failuresOf(failed.text)).toEqual([
    `${at("keyboard", "/ringless.html")} link shows no visible focus when Tab reaches it`,
    `${at("keyboard", "/skipped.html")} Tab reached link 0 of 1 time(s)`,
    `${at("keyboard", "/skipped.html")} scanned no target`,
  ]);
  expect(failed.exitCode).toBe(1);

  await site.write(sitePages({ "ringless.html": CLEAN_LINK, "skipped.html": CLEAN_LINK }));
  const passed = await site.run();
  expect(passed.text).toContain(`browser: ${at("keyboard", "/skipped.html").slice(0, -1)} scanned link 1`);
  expect(passed.exitCode).toBe(0);
}, 120_000);

test("keyboard is red when Tab never leaves the page, and green once the trap is gone", async () => {
  const trap = `<button id="trap" type="button">Stay</button><script>document.getElementById("trap").addEventListener("keydown", (event) => { if (event.key === "Tab") event.preventDefault(); });</script>`;
  const site = await browserSite({
    "dist/index.html": page(`<p><a href="/">Write to me</a></p>${trap}`),
    "browser-checks.json": declaration({ checks: ["keyboard"] }),
  });
  const failed = await site.run();
  expect(failuresOf(failed.text)).toEqual([`${at("keyboard", "/")} Tab never leaves the page within 500 stops`]);
  expect(failed.exitCode).toBe(1);

  await site.write({ "dist/index.html": page(`<p><a href="/">Write to me</a></p><button type="button">Stay</button>`) });
  const passed = await site.run();
  expect(passed.text).toContain(`browser: ${at("keyboard", "/").slice(0, -1)} scanned link 1`);
  expect(passed.exitCode).toBe(0);
}, 120_000);

test("a control the page renders once for each breakpoint is judged only where it shows, and passes at every viewport", async () => {
  const site = await browserSite({
    "dist/index.html": page(`<p><a class="phone" href="/">Write</a><a class="desktop" href="/">Write to me</a></p>`, {
      head: "<style>.desktop { display: none; } @media (min-width: 1000px) { .phone { display: none; } .desktop { display: inline; } }</style>",
    }),
    "browser-checks.json": declaration({
      viewports: [
        { name: "phone", width: 320, height: 640 },
        { name: "desktop", width: 1280, height: 800 },
      ],
      checks: ["layout", "keyboard"],
    }),
  });
  const passed = await site.run();
  for (const viewport of ["phone 320x640", "desktop 1280x800"]) {
    for (const check of ["targets", "layout", "keyboard"]) expect(passed.text).toContain(`browser: ${at(check, "/", "default", viewport).slice(0, -1)} scanned link 1`);
  }
  expect(failuresOf(passed.text)).toEqual([]);
  expect(passed.exitCode).toBe(0);
}, 120_000);

test("motion is red on a hover transition a visitor who turns motion off still sees, and green once it waits for no-preference", async () => {
  const hovered = (css: string): string => page(`<p><a href="/">Write to me</a></p>`, { head: `<style>${css}</style>` });
  const site = await browserSite({
    "dist/index.html": hovered("a { transition: color 300ms; } a:hover { color: red; }"),
    "browser-checks.json": declaration({ states: [{ name: "default" }, { name: "reduced motion", reducedMotion: "reduce" }], checks: ["motion"] }),
  });
  const failed = await site.run();
  const reversed = "motion at / (en), phone 320x640, reduced motion: color animated on leaving control 1";
  expect(failuresOf(failed.text).filter((line) => line !== reversed)).toEqual(["motion at / (en), phone 320x640, reduced motion: color animated on hovering control 1"]);
  expect(failed.text).not.toContain("motion at / (en), phone 320x640, default");
  expect(failed.exitCode).toBe(1);

  await site.write({ "dist/index.html": hovered("@media (prefers-reduced-motion: no-preference) { a { transition: color 300ms; } } a:hover { color: red; }") });
  const passed = await site.run();
  expect(passed.text).toContain("browser: motion at / (en), phone 320x640, reduced motion scanned 1 control(s)");
  expect(passed.exitCode).toBe(0);
}, 120_000);

test("motion is red on an animation during load, a focus transition and smooth scrolling, skips hovering a control off the screen, and is green under the common reduced-motion reset", async () => {
  const RESET =
    "@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; scroll-behavior: auto !important; } }";
  const moving = (css: string): string =>
    page(`<a href="#content" style="position: absolute; left: -9999px">Skip to the content</a><p id="content"><a class="write" href="/">Write to me</a></p>`, {
      head: `<style>@keyframes arrive { from { opacity: 0; } } main { animation: arrive 1s; } html { scroll-behavior: smooth; } .write { transition: background-color 300ms; } .write:focus { background-color: yellow; }${css}</style>`,
    });
  const site = await browserSite({
    "dist/index.html": moving(""),
    "browser-checks.json": declaration({ states: [{ name: "reduced motion", reducedMotion: "reduce" }], checks: ["motion"] }),
  });
  const failed = await site.run();
  expect(failuresOf(failed.text)).toEqual([
    "motion at / (en), phone 320x640, reduced motion: arrive animated during load",
    "motion at / (en), phone 320x640, reduced motion: the page scrolls smoothly",
    "motion at / (en), phone 320x640, reduced motion: background-color animated on focusing control 2",
  ]);
  expect(failed.exitCode).toBe(1);

  await site.write({ "dist/index.html": moving(RESET) });
  const passed = await site.run();
  expect(passed.text).toContain("browser: motion at / (en), phone 320x640, reduced motion scanned 2 control(s), 1 it cannot hover, judged on focus alone");
  expect(passed.exitCode).toBe(0);
}, 120_000);

test("axe is red on nested interactive markup, low contrast and a viewport that disables zoom, reports contrast it cannot measure as unverified, and is green once each is fixed", async () => {
  const red = {
    "nested.html": page(`<p><button type="button">Open <a href="/">the row</a></button></p>`),
    "faint.html": page(`<p style="color: #aaa; background: #fff">Write to me at <a href="/" style="color: #000">this address</a></p>`),
    "zoomless.html": page(`<p><a href="/">Write to me</a></p>`, { viewport: "width=device-width, maximum-scale=1, user-scalable=no" }),
    "pictured.html": page(`<p style="background-image: url('data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22/>'); color: #000">Over a picture <a href="/">Write to me</a></p>`),
  };
  const site = await browserSite({ ...sitePages(red), "browser-checks.json": declaration({ routes: routesOf(red), checks: ["axe"] }) });
  const failed = await site.run();
  const failures = failuresOf(failed.text);
  expect(failures.filter((line) => line.startsWith(`${at("axe", "/nested.html")} nested-interactive (serious): button`))).toHaveLength(1);
  expect(failures.filter((line) => line.startsWith(`${at("axe", "/faint.html")} color-contrast (serious): p`))).toHaveLength(1);
  expect(failures.filter((line) => line.startsWith(`${at("axe", "/zoomless.html")} meta-viewport (moderate)`))).toHaveLength(1);
  expect(failures.filter((line) => line.includes("/pictured.html"))).toEqual([]);
  expect(failed.text).toContain(`browser: 2 contrast check(s) axe cannot measure, reported as unverified:\n  ${at("axe", "/pictured.html")} color-contrast unverified: p:`);
  expect(failed.exitCode).toBe(1);

  await site.write(sitePages({ "nested.html": CLEAN_LINK, "faint.html": CLEAN_LINK, "zoomless.html": CLEAN_LINK }));
  const passed = await site.run();
  expect(failuresOf(passed.text)).toEqual([]);
  expect(passed.text).toContain(`color-contrast unverified`);
  expect(passed.exitCode).toBe(0);
}, 120_000);

test("nesting is red on a button inside a link and on a link inside a button, and green once each control stands alone", async () => {
  const red = {
    "button-in-link.html": page(`<p><a href="/">Open the row <button type="button">Archive</button></a></p>`),
    "link-in-button.html": page(`<p><button type="button">Open <a href="/">the row</a></button></p>`),
  };
  const site = await browserSite({ ...sitePages(red), "browser-checks.json": declaration({ routes: routesOf(red), checks: ["nesting"] }) });
  const failed = await site.run();
  expect(failuresOf(failed.text)).toEqual([
    `${at("nesting", "/button-in-link.html")} <button> element is not permitted as a descendant of <a> at 1:198 of the rendered page`,
    `${at("nesting", "/link-in-button.html")} <a> element is not permitted as a descendant of <button> at 1:200 of the rendered page`,
  ]);
  expect(failed.exitCode).toBe(1);

  await site.write(sitePages({ "button-in-link.html": page(`<p><a href="/">Open the row</a> <button type="button">Archive</button></p>`), "link-in-button.html": CLEAN_LINK }));
  const passed = await site.run();
  expect(failuresOf(passed.text)).toEqual([]);
  expect(passed.exitCode).toBe(0);
}, 120_000);

test("assets is red on an image the site does not serve and on a request that fails, and green once both load", async () => {
  const pictured = (src: string): string => page(`<p><a href="/">Write to me</a></p><img src="${src}" alt="The owner" width="10" height="10">`);
  const site = await browserSite({
    "dist/index.html": pictured("/portrait.svg"),
    "dist/refused.html": pictured("http://127.0.0.1:1/portrait.svg"),
    "browser-checks.json": declaration({ routes: [{ path: "/", locale: "en" }, { path: "/refused.html", locale: "en" }], checks: ["assets"] }),
  });
  const failed = await site.run();
  expect(failuresOf(failed.text)).toEqual([
    expect.stringMatching(/^assets at \/ \(en\), phone 320x640, default: http:\/\/127\.0\.0\.1:\d+\/portrait\.svg answers 404$/),
    `${at("assets", "/refused.html")} http://127.0.0.1:1/portrait.svg fails to load: net::ERR_UNSAFE_PORT`,
  ]);
  expect(failed.exitCode).toBe(1);

  await site.write({ "dist/portrait.svg": `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>`, "dist/refused.html": pictured("/portrait.svg") });
  const passed = await site.run();
  expect(passed.text).toContain("browser: assets at / (en), phone 320x640, default scanned 2 request(s)");
  expect(passed.exitCode).toBe(0);
}, 120_000);

test("a declared target fails when it matches no visible element whichever checks are declared, and passes once it shows", async () => {
  const site = await browserSite({
    "dist/index.html": page("<p>No link here</p>"),
    "browser-checks.json": declaration({ targets: [{ name: "link", selector: "main a" }], checks: ["assets"] }),
  });
  const failed = await site.run();
  expect(failuresOf(failed.text)).toEqual([`${at("targets", "/")} link (main a) matches no visible element`]);
  expect(failed.exitCode).toBe(1);

  await site.write({ "dist/index.html": CLEAN_LINK });
  const passed = await site.run();
  expect(passed.text).toContain(`browser: ${at("targets", "/").slice(0, -1)} scanned link 1`);
  expect(passed.exitCode).toBe(0);
}, 120_000);

test("a declared route the site does not serve fails, and the run passes once the route is built", async () => {
  const site = await browserSite({
    "dist/index.html": CLEAN_LINK,
    "browser-checks.json": declaration({ routes: [{ path: "/", locale: "en" }, { path: "/ru/", locale: "ru" }], checks: ["layout"] }),
  });
  const failed = await site.run();
  expect(failuresOf(failed.text)).toEqual(["route /ru/ serves no page from the declared site"]);
  expect(failed.exitCode).toBe(1);

  await site.write({ "dist/ru/index.html": page(`<p><a href="/">Написать мне</a></p>`, { lang: "ru" }) });
  const passed = await site.run();
  expect(passed.text).toContain("browser: layout at /ru/ (ru), phone 320x640, default scanned link 1");
  expect(passed.exitCode).toBe(0);
}, 120_000);

test("without a declaration, with an empty target list, a missing site or a motion check no state can judge, the runner refuses before it starts a browser", async () => {
  const unlaunchable = { CHROME_PATH: "/nonexistent/chrome" };
  const site = await browserSite({ "dist/index.html": CLEAN_LINK });
  const cases = [
    [undefined, "browser: browser-checks.json is missing, and a product opts in to the browser checks by declaring its pages there"],
    [declaration({ targets: [], checks: ["layout"] }), "browser: browser-checks.json does not decode"],
    [declaration({ site: "build", checks: ["layout"] }), "browser: the declared site build is not a directory, so build the site before the browser checks run"],
    [declaration({ checks: ["motion"] }), "check motion judges a visitor who turns motion off, and no state sets reducedMotion to reduce"],
    [declaration({ checks: ["layout"], hooks: "tests/browser/hooks.ts" }), "browser: the declared hooks module tests/browser/hooks.ts is missing"],
  ] as const;
  for (const [declared, message] of cases) {
    if (declared !== undefined) await site.write({ "browser-checks.json": declared });
    const refused = await site.run(unlaunchable);
    expect({ text: refused.text, exitCode: refused.exitCode }).toEqual({ text: expect.stringContaining(message), exitCode: 2 });
    expect(refused.text).not.toContain("Chrome");
  }
}, 120_000);

const SAVES = (ordered: boolean): string =>
  page(
    `<p><button id="save-a" type="button">Save A</button> <button id="save-b" type="button">Save B</button></p><p><output id="saved">Nothing saved</output></p>
<form id="language-form"><label>Language <select id="language" name="language"><option value="en">English</option><option value="ru">Русский</option>${ordered ? "" : '<option value="de">Deutsch</option>'}</select></label><button type="submit">Use it</button></form>
<script>
  const saved = document.getElementById("saved");
  let latest = 0;
  let unsent = null;
  const save = (value) => {
    latest += 1;
    const mine = latest;
    fetch("/api/save?value=" + value)
      .then((response) => (${String(ordered)} && !response.ok ? value + " unsaved" : response.text()))
      .catch(() => {
        unsent = value;
        return value + " unsaved";
      })
      .then((text) => {
        if (${String(ordered)} && mine !== latest) return;
        saved.textContent = text;
      });
  };
  document.getElementById("save-a").addEventListener("click", () => save("A"));
  document.getElementById("save-b").addEventListener("click", () => save("B"));
  window.addEventListener("online", () => {
    if (!${String(ordered)} || unsent === null) return;
    const value = unsent;
    unsent = null;
    save(value);
  });
  document.getElementById("language-form").addEventListener("submit", (event) => {
    event.preventDefault();
    fetch("/api/language", { method: "POST", body: document.getElementById("language").value });
  });
</script>`,
  );

const HOOKS = (hookTypes: string): string => `import { Schema } from "effect";
import type { Route } from "playwright-core";
import type { ProductCheck } from "${hookTypes}";

const Language = Schema.Literals(["en", "ru"]);

const settled = (page: Parameters<ProductCheck["run"]>[0]) => page.evaluate("new Promise((resolve) => setTimeout(resolve, 200))");

async function heldSaves(page: Parameters<ProductCheck["run"]>[0], url: string): Promise<Map<string, Route>> {
  const held = new Map<string, Route>();
  await page.route("**/api/save?**", (route) => {
    held.set(new URL(route.request().url()).searchParams.get("value") ?? "", route);
  });
  await page.goto(url);
  await page.click("#save-a");
  await page.click("#save-b");
  while (held.size < 2) await page.waitForTimeout(10);
  return held;
}

export const checks: readonly ProductCheck[] = [
  {
    name: "a late reply never replaces a newer save",
    run: async (page, visit) => {
      const held = await heldSaves(page, visit.url);
      await held.get("B")?.fulfill({ body: "B saved" });
      await page.locator("#saved", { hasText: "B saved" }).waitFor();
      await Promise.all([page.waitForResponse("**/api/save?value=A"), held.get("A")?.fulfill({ body: "A saved" })]);
      await settled(page);
      const shown = await page.textContent("#saved");
      return { targets: ["saved result"], found: shown === "B saved" ? [] : [\`the saved result shows "\${shown}" once the late reply to A lands\`] };
    },
  },
  {
    name: "a rejected save shows as unsaved",
    run: async (page, visit) => {
      const held = await heldSaves(page, visit.url);
      await Promise.all([page.waitForResponse("**/api/save?value=A"), held.get("A")?.fulfill({ body: "A saved" })]);
      await settled(page);
      await Promise.all([page.waitForResponse("**/api/save?value=B"), held.get("B")?.fulfill({ status: 503, body: "" })]);
      await settled(page);
      const shown = await page.textContent("#saved");
      return { targets: ["saved result"], found: shown === "B unsaved" ? [] : [\`the saved result shows "\${shown}" after the save of B was refused\`] };
    },
  },
  {
    name: "a save refused while offline lands once the page reconnects",
    run: async (page, visit) => {
      let online = false;
      await page.route("**/api/save?**", (route) =>
        online ? route.fulfill({ body: \`\${new URL(route.request().url()).searchParams.get("value")} saved\` }) : route.abort("internetdisconnected"),
      );
      await page.goto(visit.url);
      await page.context().setOffline(true);
      await page.click("#save-b");
      await page.locator("#saved", { hasText: "B unsaved" }).waitFor();
      online = true;
      await page.context().setOffline(false);
      await settled(page);
      const shown = await page.textContent("#saved");
      return { targets: ["saved result"], found: shown === "B saved" ? [] : [\`the saved result shows "\${shown}" once the page reconnects\`] };
    },
  },
  {
    name: "every offered language decodes at the boundary",
    run: async (page, visit) => {
      const submitted: string[] = [];
      await page.route("**/api/language", async (route) => {
        submitted.push(route.request().postData() ?? "");
        await route.fulfill({ status: 204 });
      });
      await page.goto(visit.url);
      const offered = await page.locator("#language option").evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
      for (const value of offered) {
        await page.selectOption("#language", value);
        await Promise.all([page.waitForRequest("**/api/language"), page.click("#language-form button")]);
      }
      const refused = submitted.filter((value) => !Schema.is(Language)(value));
      return { targets: offered.map(() => "language choice"), found: refused.map((value) => \`the language control offers \${value}, which the boundary refuses\`) };
    },
  },
];
`;

test("product hooks are red on a late reply that replaces a newer save, a refused save that blanks the result, an offline save that never lands and a choice the boundary refuses, and green once the page is fixed", async () => {
  const site = await browserSite({
    "dist/index.html": SAVES(false),
    "tests/browser/hooks.ts": HOOKS(HOOK_TYPES),
    "browser-checks.json": declaration({ checks: ["layout"], targets: [{ name: "save button", selector: "#save-a, #save-b" }], hooks: "tests/browser/hooks.ts" }),
  });
  const failed = await site.run();
  expect(failuresOf(failed.text)).toEqual([
    `${at("hook a late reply never replaces a newer save", "/")} the saved result shows "A saved" once the late reply to A lands`,
    `${at("hook a rejected save shows as unsaved", "/")} the saved result shows "" after the save of B was refused`,
    `${at("hook a save refused while offline lands once the page reconnects", "/")} the saved result shows "B unsaved" once the page reconnects`,
    `${at("hook every offered language decodes at the boundary", "/")} the language control offers de, which the boundary refuses`,
  ]);
  expect(failed.text).toContain("browser: hook every offered language decodes at the boundary at / (en), phone 320x640, default scanned language choice 3");
  expect(failed.exitCode).toBe(1);

  await site.write({ "dist/index.html": SAVES(true) });
  const passed = await site.run();
  expect(passed.text).toContain("browser: hook a late reply never replaces a newer save at / (en), phone 320x640, default scanned saved result 1");
  expect(passed.text).toContain("browser: hook a rejected save shows as unsaved at / (en), phone 320x640, default scanned saved result 1");
  expect(passed.text).toContain("browser: hook a save refused while offline lands once the page reconnects at / (en), phone 320x640, default scanned saved result 1");
  expect(passed.text).toContain("browser: 6 check run(s) over 1 route(s), 1 viewport(s), 1 state(s) and 1 target(s) pass");
  expect(passed.exitCode).toBe(0);
}, 120_000);

test("a hook that throws or scans no target fails at its visit", async () => {
  const site = await browserSite({
    "dist/index.html": CLEAN_LINK,
    "tests/browser/hooks.ts": `export const checks = [
  { name: "throws", run: async () => { throw new Error("the product broke"); } },
  { name: "empty", run: async () => ({ targets: [], found: [] }) },
];
`,
    "browser-checks.json": declaration({ checks: ["layout"], hooks: "tests/browser/hooks.ts" }),
  });
  const failed = await site.run();
  expect(failuresOf(failed.text)).toEqual([
    `${at("hook throws", "/")} hook throws throws: the product broke`,
    `${at("hook throws", "/")} scanned no target`,
    `${at("hook empty", "/")} scanned no target`,
  ]);
  expect(failed.exitCode).toBe(1);
}, 120_000);
