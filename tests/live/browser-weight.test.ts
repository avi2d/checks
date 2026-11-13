import { expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { at, browserSite, declaration, failuresOf, page, sitePages } from "../e2e/lib/browser-site.ts";

function paddedSvgOfSizeBytes(size: number): string {
  const prefix = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="red"/><!--`;
  const suffix = `--></svg>`;
  return `${prefix}${"x".repeat(size - prefix.length - suffix.length)}${suffix}`;
}

function paddedJsOfSizeBytes(size: number): string {
  return `//${"x".repeat(size - 2)}`;
}

function randomJsOfSizeBytes(size: number): string {
  return `//${randomBytes(size).toString("base64").slice(0, size - 2)}`;
}

const BUDGETS = { nonImageBytes: 200_000, scriptBytes: 150_000, imageBytes: 200_000 };

const pictured = (src: string): string => page(`<p><a href="/">Write to me</a></p><img src="${src}" alt="A red square">`);

const lazy = (src: string): string =>
  page(`<div style="height: 300vh"></div><p><a href="/">Write to me</a></p><img src="${src}" alt="A red square" loading="lazy">`);

const scripted = (src: string): string => page(`<p><a href="/">Write to me</a></p>`, { head: `<script src="${src}"></script>` });

test("weight is red on a page over its image, script and non-image budgets, and green once each page holds", async () => {
  const site = await browserSite({
    ...sitePages({
      "eager.html": pictured("/medium.svg"),
      "lazy.html": lazy("/big.svg"),
      "scripts.html": scripted("/heavy.js"),
      "repetitive.html": scripted("/repetitive.js"),
    }),
    "dist/medium.svg": paddedSvgOfSizeBytes(100_000),
    "dist/big.svg": paddedSvgOfSizeBytes(600_000),
    "dist/heavy.js": randomJsOfSizeBytes(700_000),
    "dist/repetitive.js": paddedJsOfSizeBytes(1_000_000),
    "browser-checks.json": declaration({
      routes: [{ path: "/eager.html", locale: "en" }, { path: "/lazy.html", locale: "en" }, { path: "/scripts.html", locale: "en" }, { path: "/repetitive.html", locale: "en" }],
      checks: ["weight"],
      weight: BUDGETS,
    }),
  });
  const failed = await site.run();
  const failures = failuresOf(failed.text);
  expect(failures.filter((line) => line.startsWith(at("weight", "/lazy.html")))).toEqual([
    `${at("weight", "/lazy.html")} 600000 bytes of images over 200000 (over by 400000)`,
  ]);
  const scripts = failures.filter((line) => line.startsWith(at("weight", "/scripts.html")));
  expect(scripts.filter((line) => line.includes("bytes of scripts over 150000"))).toHaveLength(1);
  expect(scripts.filter((line) => line.includes("bytes besides images over 200000"))).toHaveLength(1);
  expect(failures.filter((line) => line.startsWith(at("weight", "/eager.html")))).toEqual([]);
  expect(failures.filter((line) => line.startsWith(at("weight", "/repetitive.html")))).toEqual([]);
  expect(failed.exitCode).toBe(1);

  await site.write(
    sitePages({
      "eager.html": pictured("/medium.svg"),
      "lazy.html": lazy("/medium.svg"),
      "scripts.html": scripted("/repetitive.js"),
      "repetitive.html": scripted("/repetitive.js"),
    }),
  );
  const passed = await site.run();
  expect(failuresOf(passed.text)).toEqual([]);
  for (const path of ["/eager.html", "/lazy.html", "/scripts.html", "/repetitive.html"]) {
    expect(passed.text).toContain(`browser: ${at("weight", path).slice(0, -1)} scanned`);
  }
  expect(passed.exitCode).toBe(0);
}, 120_000);
