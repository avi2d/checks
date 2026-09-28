import { expect, test } from "bun:test";
import { Option } from "effect";
import { buildFor, refreshPlan, REFRESH_HOURS, USABLE_DAYS, usableWithoutRefresh } from "../../src/dependencies/osv-scanner.ts";

const HOUR = 3_600_000;

test("each platform a runner or a laptop uses has a pinned build, and any other has none", () => {
  expect(Option.map(buildFor("linux", "x64"), ({ asset }) => asset)).toEqual(Option.some("osv-scanner_linux_amd64"));
  expect(Option.map(buildFor("darwin", "arm64"), ({ asset }) => asset)).toEqual(Option.some("osv-scanner_darwin_arm64"));
  expect(Option.getOrUndefined(buildFor("darwin", "arm64"))?.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(buildFor("win32", "x64")).toEqual(Option.none());
});

test("the database refreshes once its last refresh is a day old, or when it never refreshed", () => {
  expect(refreshPlan(Option.none())).toBe("refresh");
  expect(refreshPlan(Option.some(REFRESH_HOURS * HOUR - 1))).toBe("offline");
  expect(refreshPlan(Option.some(REFRESH_HOURS * HOUR + 1))).toBe("refresh");
});

test("a database stays usable after a failed refresh only while its last refresh is within a week", () => {
  expect(usableWithoutRefresh(Option.none())).toBe(false);
  expect(usableWithoutRefresh(Option.some(USABLE_DAYS * 24 * HOUR - 1))).toBe(true);
  expect(usableWithoutRefresh(Option.some(USABLE_DAYS * 24 * HOUR + 1))).toBe(false);
});
