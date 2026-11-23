import { expect, test } from "bun:test";
import { formatTimings } from "../../../src/quality/browser/report.ts";

test("timings group repeated checks by page without summing overlapping wall times", () => {
  expect(formatTimings([
    { path: "/", check: "targets", start: 0, end: 10 },
    { path: "/", check: "axe", start: 5, end: 25 },
    { path: "/", check: "axe", start: 30, end: 40 },
    { path: "/about/", check: "hook choices", start: 8, end: 20 },
  ])).toBe("browser: timing /: targets 10ms, axe 30ms; total 40ms\nbrowser: timing /about/: hook choices 12ms; total 12ms");
});
