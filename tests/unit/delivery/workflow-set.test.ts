import { expect, test } from "bun:test";
import { byHandSet, differencesOf, requiredSet } from "../../../src/delivery/workflow-set.ts";
import { isRecord } from "../../../src/delivery/workflow-references.ts";
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

const SHARED_V3_FILES = ["advisories.yml", "ci.yml", "mutation.yml", "pr-title.yml", "preview-remove.yml", "release-main.yml", "release-pr.yml", "site-ci.yml", "site-main.yml", "site-production.yml"];

test("no advisories, mutation or required caller pins below v3 or names a file the v3 tag lacks", () => {
  const callers = [...requiredSet("code"), ...requiredSet("site"), ...byHandSet("site"), { name: "mutation.yml", text: MUTATION_WORKFLOW }];
  const pins = callers.flatMap(({ text }) => {
    const document = Bun.YAML.parse(text);
    const jobs = isRecord(document) ? document["jobs"] : undefined;
    if (!isRecord(jobs)) return [];
    return Object.values(jobs).flatMap((job) => (isRecord(job) && typeof job["uses"] === "string" ? [job["uses"]] : []));
  });
  expect(pins.length).toBeGreaterThan(0);
  const v3Pins = SHARED_V3_FILES.map((file) => `avi2d/workflows/.github/workflows/${file}@v3`);
  expect(pins.filter((pin) => !v3Pins.includes(pin))).toEqual([]);
});

test("a ci caller that omits ready_for_review never starts when a draft is marked ready, so the draft hold never releases", () => {
  for (const kind of ["code", "site"] as const) {
    const ci = requiredSet(kind).find(({ name }) => name === "ci.yml");
    const document = Bun.YAML.parse(ci?.text ?? "");
    const on = isRecord(document) ? document["on"] : undefined;
    const pullRequest = isRecord(on) ? on["pull_request"] : undefined;
    const types = isRecord(pullRequest) ? pullRequest["types"] : undefined;
    expect(types).toContain("ready_for_review");
  }
});

const CALLEE_GRANTS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "advisories.yml": { contents: "read", issues: "write" },
  "ci.yml": { contents: "read", actions: "write", statuses: "write", "pull-requests": "read" },
  "mutation.yml": { contents: "read", actions: "write", "pull-requests": "write" },
  "pr-title.yml": { contents: "read", statuses: "write", "pull-requests": "read" },
  "preview-remove.yml": { contents: "read", "pull-requests": "write" },
  "release-main.yml": { contents: "write", "id-token": "write", actions: "read", "pull-requests": "read" },
  "release-pr.yml": { contents: "write", "pull-requests": "write", actions: "write" },
  "site-ci.yml": { contents: "read", actions: "write", statuses: "write", "pull-requests": "write" },
  "site-main.yml": { contents: "write", actions: "read", "pull-requests": "read" },
  "site-production.yml": { contents: "read", actions: "read", "pull-requests": "read" },
};

const callers = (): readonly { name: string; text: string }[] => [
  ...requiredSet("code"),
  ...requiredSet("site"),
  ...byHandSet("site"),
  { name: "mutation.yml", text: MUTATION_WORKFLOW },
];

const callerJob = (text: string): Record<string, unknown> => {
  const document = Bun.YAML.parse(text);
  const jobs = isRecord(document) ? document["jobs"] : undefined;
  const job = isRecord(jobs) ? Object.values(jobs)[0] : undefined;
  return isRecord(job) ? job : {};
};

test("each caller grants exactly the scopes its v3 job declares, so a spare deployments: write or a missing actions: write fails here", () => {
  for (const { name, text } of callers()) {
    const job = callerJob(text);
    const file = String(job["uses"]).split("/").pop()?.replace(/@v3$/, "");
    expect([name, job["permissions"]]).toEqual([name, CALLEE_GRANTS[file ?? ""]]);
  }
});

test("only the ci and pr-title callers hold a workflow-level group, so a release, main or production caller cannot hold one its shared job also holds", () => {
  const held = callers()
    .filter(({ text }) => {
      const document = Bun.YAML.parse(text);
      return isRecord(document) && document["concurrency"] !== undefined;
    })
    .map(({ name }) => name);
  expect(held).toEqual(["ci.yml", "pr-title.yml", "ci.yml", "pr-title.yml"]);
});
