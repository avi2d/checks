import { expect, test } from "bun:test";
import { Option } from "effect";
import { buildFor, refreshAge, refreshPlan, REFRESH_HOURS, USABLE_DAYS, usableWithoutRefresh } from "../../src/dependencies/osv-scanner.ts";

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

test("a refresh marker dated ahead of the clock or unreadable counts as no refresh, so the scan refreshes", () => {
  const now = Date.parse("2026-09-28T12:00:00Z");
  expect(refreshAge(Option.some("2026-09-28T10:00:00.000Z\n"), now)).toEqual(Option.some(2 * HOUR));
  expect(refreshAge(Option.some("2026-09-28T12:00:00.000Z"), now)).toEqual(Option.some(0));
  expect(refreshAge(Option.some("2026-09-29T12:00:00.000Z"), now)).toEqual(Option.none());
  expect(refreshAge(Option.some("yesterday"), now)).toEqual(Option.none());
  expect(refreshAge(Option.none(), now)).toEqual(Option.none());
  expect(refreshPlan(refreshAge(Option.some("2027-01-01T00:00:00.000Z"), now))).toBe("refresh");
  expect(usableWithoutRefresh(refreshAge(Option.some("2027-01-01T00:00:00.000Z"), now))).toBe(false);
});
