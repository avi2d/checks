import { expect, test } from "bun:test";
import { at, browserSite, declaration, failuresOf, page } from "../e2e/lib/browser-site.ts";

const still = (): string => page(`<p><a href="/">Write to me</a></p>`);

const shifting = (): string =>
  page(`<div id="banner"></div><p><a href="/">Write to me</a></p>`, {
    head: `<script>setTimeout(() => { document.getElementById("banner").style.height = "300px"; }, 300);</script>`,
  });

test("shift is red on a cold load the page moves, and green once the page holds still", async () => {
  const site = await browserSite({
    "dist/index.html": shifting(),
    "dist/still.html": still(),
    "browser-checks.json": declaration({
      routes: [{ path: "/", locale: "en" }, { path: "/still.html", locale: "en" }],
      checks: ["shift"],
      shift: { max: 0.1 },
    }),
  });
  const failed = await site.run();
  const failures = failuresOf(failed.text);
  expect(failures.filter((line) => line.startsWith(at("shift", "/still.html")))).toEqual([]);
  const moving = failures.filter((line) => line.startsWith(at("shift", "/")));
  expect(moving).toHaveLength(1);
  const total = /shifts ([0-9.]+), over the 0\.1 bound/.exec(moving[0] ?? "")?.[1];
  expect(total !== undefined && Number.parseFloat(total) > 0.1).toBe(true);
  expect(failed.exitCode).toBe(1);

  await site.write({ "dist/index.html": still() });
  const passed = await site.run();
  expect(failuresOf(passed.text)).toEqual([]);
  expect(passed.text).toContain(`browser: ${at("shift", "/").slice(0, -1)} scanned shift 0.000`);
  expect(passed.exitCode).toBe(0);
}, 120_000);
