import { expect, test } from "bun:test";
import { byHandSet, differencesOf, requiredSet } from "../../../src/delivery/workflow-set.ts";
import { MUTATION_WORKFLOW } from "../../../src/delivery/setup-workflow.ts";

test("the code set is ci, pr-title, main and release, and the site set adds preview-close and production", () => {
  expect(requiredSet("code").map(({ name }) => name)).toEqual(["ci.yml", "pr-title.yml", "main.yml", "release.yml"]);
  expect(requiredSet("site").map(({ name }) => name)).toEqual(["ci.yml", "pr-title.yml", "preview-close.yml", "main.yml", "release.yml", "production.yml"]);
});

test("the two kinds share pr-title and release byte for byte, so neither drifts between sites and code", () => {
  const code = new Map(requiredSet("code").map(({ name, text }) => [name, text]));
  const site = new Map(requiredSet("site").map(({ name, text }) => [name, text]));
  expect(site.get("pr-title.yml")).toBe(code.get("pr-title.yml") ?? "no pr-title.yml");
  expect(site.get("release.yml")).toBe(code.get("release.yml") ?? "no release.yml");
  expect(site.get("ci.yml")).not.toBe(code.get("ci.yml"));
});

test("an absent by-hand caller is no difference, but one that runs its own steps is", () => {
  const written = requiredSet("code");
  expect(differencesOf("code", written)).toEqual([]);
  expect(byHandSet("site").map(({ name }) => name)).toEqual(["advisories.yml"]);
  const handRolled = { name: "mutation.yml", text: "name: mutation\non:\n  workflow_dispatch:\n" };
  expect(differencesOf("code", [...written, handRolled]).map(({ kind, name }) => [kind, name])).toEqual([["differs", "mutation.yml"]]);
  expect(differencesOf("site", [...requiredSet("site"), handRolled]).map(({ kind, name }) => [kind, name])).toEqual([["extra", "mutation.yml"]]);
});

// The files avi2d/workflows at tag v3 holds, which every caller the generator writes must name at v3.
const SHARED_V3_FILES = ["advisories.yml", "ci.yml", "mutation.yml", "pr-title.yml", "preview-remove.yml", "release-main.yml", "release-pr.yml", "site-ci.yml", "site-main.yml", "site-production.yml"];

test("no caller the set writes pins below v3, and none names a file the v3 tag lacks", () => {
  const callers = [...requiredSet("code"), ...requiredSet("site"), ...byHandSet("site"), { name: "mutation.yml", text: MUTATION_WORKFLOW }];
  const pins = callers.flatMap(({ text }) => [...text.matchAll(/avi2d\/workflows\/\.github\/workflows\/([\w.-]+)@(\S+)/g)].map(([, file, ref]) => `${file}@${ref}`));
  expect(pins.length).toBeGreaterThan(0);
  const v3Pins = SHARED_V3_FILES.map((file) => `${file}@v3`);
  expect(pins.filter((pin) => !v3Pins.includes(pin))).toEqual([]);
});

test("a ci caller that omits ready_for_review never starts when a draft is marked ready, so the draft hold never releases", () => {
  for (const kind of ["code", "site"] as const) {
    const ci = requiredSet(kind).find(({ name }) => name === "ci.yml");
    expect(ci?.text).toContain("  types: [opened, synchronize, reopened, ready_for_review]\n");
  }
});
