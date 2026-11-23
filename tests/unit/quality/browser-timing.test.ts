import { expect, test } from "bun:test";
import { formatTimings } from "../../../src/quality/browser/report.ts";

test("route check sums exclude gaps and other routes without collapsing overlapping checks", () => {
  expect(formatTimings([
    { path: "/", check: "targets", start: 0, end: 10 },
    { path: "/", check: "axe", start: 5, end: 25 },
    { path: "/", check: "axe", start: 70, end: 80 },
    { path: "/about/", check: "hook choices", start: 25, end: 65 },
  ])).toBe("browser: timing /: targets 10ms, axe 30ms; check sum 40ms\nbrowser: timing /about/: hook choices 40ms; check sum 40ms");
});
