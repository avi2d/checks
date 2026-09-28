import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Effect, Exit } from "effect";
import {
  clockOf,
  decodeAcknowledgements,
  decodeOsvReport,
  findingsIn,
  introducedBy,
  judge,
  passes,
  report,
  summaryOf,
  type Acknowledgement,
  type Finding,
} from "../../src/dependencies/advisory-rules.ts";

const HEAD_AT = Date.parse("2026-09-27T12:00:00Z");

function recorded(name: string) {
  const text = readFileSync(resolve(import.meta.dir, "..", "fixtures", "advisories", `${name}.json`), "utf8");
  return Effect.runSync(decodeOsvReport(text));
}

const atBase = (path: string): boolean => path.endsWith("/base/bun.lock");
const atHead = (path: string): boolean => path.endsWith("/head/bun.lock");

function keys(findings: readonly Finding[]): readonly string[] {
  return findings.map(({ name, version, id }) => `${name}@${version} ${id}`).toSorted();
}

function acknowledgement(pkg: string, id: string, until: string): Acknowledgement {
  return { package: pkg, id, until, reason: "the path never reaches untrusted input" };
}

function finding(name: string, id: string, aliases: readonly string[] = []): Finding {
  return { name, version: "1.0.0", id, ids: [id, ...aliases], severity: "high", summary: "" };
}

test("a planted lodash and a nested minimist show up at the head of a recorded scan, and nowhere at its base", () => {
  const planted = recorded("planted");
  expect(findingsIn(planted, atBase)).toEqual([]);
  expect(keys(findingsIn(planted, atHead))).toEqual([
    "lodash@4.17.20 GHSA-29mw-wpgm-hmr9",
    "lodash@4.17.20 GHSA-35jh-r3h4-6jhm",
    "lodash@4.17.20 GHSA-f23m-r3pf-42rh",
    "lodash@4.17.20 GHSA-r5fr-rjxr-66jc",
    "lodash@4.17.20 GHSA-xxjr-mmjv-4gpg",
    "minimist@0.0.8 GHSA-vh95-rmgr-6w4m",
    "minimist@0.0.8 GHSA-xvch-5gv4-984h",
  ]);
  const critical = findingsIn(planted, atHead).find(({ id }) => id === "GHSA-xvch-5gv4-984h");
  expect(critical).toMatchObject({ severity: "critical", summary: "Prototype Pollution in minimist" });
});

test("every advisory of the planted range is one the range introduces", () => {
  const planted = recorded("planted");
  expect(introducedBy(findingsIn(planted, atBase), findingsIn(planted, atHead))).toHaveLength(7);
});

test("advisories found at both ends of a recorded range predate it and fail nothing", () => {
  const standing = recorded("standing");
  const base = findingsIn(standing, atBase);
  const head = findingsIn(standing, atHead);
  expect(keys(head)).toEqual([
    "qs@6.15.1 GHSA-4mjr-xmp4-gh2g",
    "qs@6.15.1 GHSA-q8mj-m7cp-5q26",
    "qs@6.15.1 GHSA-x5fp-wj9c-mxmx",
    "smol-toml@1.7.0 GHSA-7w5x-hrqm-74c2",
  ]);
  expect(judge(base, head, clockOf([], HEAD_AT))).toEqual({ failing: [], acknowledged: 0, predating: 4, problems: [] });
});

test("a malware report carries its aliases and no severity", () => {
  const malware = findingsIn(recorded("malware"), atHead);
  const chalk = malware.find(({ name }) => name === "chalk");
  expect(chalk).toMatchObject({ id: "MAL-2025-46969", severity: "unrated" });
  expect(chalk?.ids).toContain("GHSA-2v46-p5h4-248w");
});

test("an advisory the head names by an alias the base knew is not introduced", () => {
  const base = [finding("debug", "GHSA-4x49-vf9v-38px", ["CVE-2025-59144"])];
  expect(introducedBy(base, [finding("debug", "MAL-2025-46974", ["CVE-2025-59144"])])).toEqual([]);
  expect(introducedBy(base, [finding("chalk", "GHSA-4x49-vf9v-38px")])).toHaveLength(1);
});

test("an acknowledgement holds until its day begins, and only within 30 days of the head", () => {
  const live = acknowledgement("minimist", "GHSA-xvch-5gv4-984h", "2026-10-20");
  const lastDay = acknowledgement("minimist", "GHSA-vh95-rmgr-6w4m", "2026-10-27");
  const expired = acknowledgement("lodash", "GHSA-35jh-r3h4-6jhm", "2026-09-27");
  const tooFar = acknowledgement("lodash", "GHSA-29mw-wpgm-hmr9", "2099-01-01");
  expect(clockOf([live, lastDay, expired, tooFar], HEAD_AT)).toEqual({
    live: [live, lastDay],
    problems: [
      { kind: "expired", acknowledgement: expired },
      { kind: "too-far", acknowledgement: tooFar, latest: "2026-10-27" },
    ],
  });
});

test("an acknowledgement running too far covers nothing, so its advisory still fails", () => {
  const head = [finding("minimist", "GHSA-xvch-5gv4-984h")];
  const judged = judge([], head, clockOf([acknowledgement("minimist", "GHSA-xvch-5gv4-984h", "2099-01-01")], HEAD_AT));
  expect(judged.failing).toEqual(head);
  expect(judged.acknowledged).toBe(0);
  expect(judged.problems.map(({ kind }) => kind)).toEqual(["too-far"]);
});

test("a live acknowledgement covers its package's advisory by any of its ids, and one matching nothing fails", () => {
  const head = [finding("debug", "MAL-2025-46974", ["GHSA-4x49-vf9v-38px"])];
  const covering = acknowledgement("debug", "GHSA-4x49-vf9v-38px", "2026-10-01");
  const stray = acknowledgement("qs", "GHSA-4mjr-xmp4-gh2g", "2026-10-01");
  const judged = judge([], head, clockOf([covering, stray], HEAD_AT));
  expect(judged).toEqual({ failing: [], acknowledged: 1, predating: 0, problems: [{ kind: "unmatched", acknowledgement: stray }] });
  expect(passes({ kind: "scanned", scope: { kind: "range" }, judged })).toBe(false);
});

test("acknowledgements decode only with a package, an id, a calendar day and a reason", () => {
  const decoded = (entries: unknown) => Effect.runSyncExit(decodeAcknowledgements(JSON.stringify(entries)));
  const entry = acknowledgement("minimist", "GHSA-xvch-5gv4-984h", "2026-10-20");
  expect(Exit.isSuccess(decoded([entry]))).toBe(true);
  const { until: _until, ...open } = entry;
  expect(Exit.isFailure(decoded([open]))).toBe(true);
  expect(Exit.isFailure(decoded([{ ...entry, until: "2026-02-30" }]))).toBe(true);
  expect(Exit.isFailure(decoded([{ ...entry, until: "2026-13-01" }]))).toBe(true);
  expect(Exit.isFailure(decoded([{ ...entry, reason: "" }]))).toBe(true);
});

test("a range report names each advisory it adds and how to clear it", () => {
  const planted = recorded("planted");
  const judged = judge([], findingsIn(planted, atHead).filter(({ name }) => name === "minimist"), clockOf([], HEAD_AT));
  expect(report({ kind: "scanned", scope: { kind: "range" }, judged })).toBe(
    [
      "advisories: the range adds 2 advisory(ies) to bun.lock (0 at the head predate the range, 0 acknowledged); upgrade each package, or acknowledge its advisory in advisory-acks.json:",
      "  minimist@0.0.8 GHSA-vh95-rmgr-6w4m moderate: Prototype Pollution in minimist",
      "  minimist@0.0.8 GHSA-xvch-5gv4-984h critical: Prototype Pollution in minimist",
    ].join("\n"),
  );
});

test("reports for a clean range, a whole head and an unchanged lockfile", () => {
  const clean = { failing: [], acknowledged: 1, predating: 4, problems: [] };
  expect(report({ kind: "scanned", scope: { kind: "range" }, judged: clean })).toBe(
    "advisories: the range adds no advisory to bun.lock (4 at the head predate the range, 1 acknowledged)",
  );
  const standing = { ...clean, failing: [finding("qs", "GHSA-4mjr-xmp4-gh2g")] };
  expect(report({ kind: "scanned", scope: { kind: "head" }, judged: standing })).toBe(
    [
      "advisories: bun.lock at the head holds 1 unacknowledged advisory(ies); upgrade each package, or acknowledge its advisory in advisory-acks.json:",
      "  qs@1.0.0 GHSA-4mjr-xmp4-gh2g high",
    ].join("\n"),
  );
  const expired = { kind: "expired", acknowledgement: acknowledgement("lodash", "GHSA-35jh-r3h4-6jhm", "2026-09-20") } as const;
  const unchanged = { kind: "unchanged", problems: [expired] } as const;
  expect(passes(unchanged)).toBe(false);
  expect(report(unchanged)).toBe(
    [
      "advisories: bun.lock is unchanged in the range, so nothing was scanned",
      "advisories: 1 acknowledgement(s) in advisory-acks.json do not hold:",
      "  lodash GHSA-35jh-r3h4-6jhm expired on 2026-09-20; upgrade the package, or renew the entry with a new reason",
    ].join("\n"),
  );
});

test("the job summary turns each indented line into a list item", () => {
  expect(summaryOf("advisories: 1 found:\n  qs@1.0.0 GHSA-4mjr-xmp4-gh2g high")).toBe("advisories: 1 found:\n- qs@1.0.0 GHSA-4mjr-xmp4-gh2g high");
});
