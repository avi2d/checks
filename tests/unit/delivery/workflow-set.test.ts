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

test("only the ci, pr-title and code main callers hold a workflow-level group, so the site main caller cannot cancel a pending release", () => {
  const held = callers()
    .filter(({ text }) => {
      const document = Bun.YAML.parse(text);
      return isRecord(document) && document["concurrency"] !== undefined;
    })
    .map(({ name }) => name);
  expect(held).toEqual(["ci.yml", "pr-title.yml", "main.yml", "ci.yml", "pr-title.yml"]);
  const codeMain = requiredSet("code").find(({ name }) => name === "main.yml");
  const codeDocument = Bun.YAML.parse(codeMain?.text ?? "");
  expect(isRecord(codeDocument) ? codeDocument["concurrency"] : undefined).toEqual({ group: "main", "cancel-in-progress": false });
  const siteMain = requiredSet("site").find(({ name }) => name === "main.yml");
  const siteDocument = Bun.YAML.parse(siteMain?.text ?? "");
  expect(isRecord(siteDocument) ? siteDocument["concurrency"] : undefined).toBeUndefined();
});

const CALLEE_SECRETS: Readonly<Record<string, readonly string[]>> = {
  "advisories.yml": [],
  "ci.yml": [],
  "mutation.yml": [],
  "pr-title.yml": [],
  "preview-remove.yml": ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
  "release-main.yml": [],
  "release-pr.yml": [],
  "site-ci.yml": ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
  "site-main.yml": ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
  "site-production.yml": ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "PRODUCTION_DEPLOY_KEY"],
};

const passedSecrets = (text: string): readonly string[] => {
  const secrets = callerJob(text)["secrets"];
  return isRecord(secrets) ? Object.keys(secrets) : [];
};

const declaredSecrets = (text: string): readonly string[] => CALLEE_SECRETS[String(callerJob(text)["uses"]).split("/").pop()?.replace(/@v3$/, "") ?? ""] ?? ["no such shared workflow"];

const siteCaller = (name: string): string => requiredSet("site").find((file) => file.name === name)?.text ?? `no ${name}`;

const withSiteCaller = (name: string, text: string): readonly { name: string; text: string }[] =>
  requiredSet("site").map((file) => (file.name === name ? { name, text } : file));

test("a caller written with secrets: inherit passes nothing to a shared workflow of another organization, so it is drift", () => {
  for (const { name, text } of callers()) expect([name, callerJob(text)["secrets"]]).not.toEqual([name, "inherit"]);
  const inherited = siteCaller("ci.yml").replace(/ {4}secrets:\n(?: {6}.*\n)+/, "    secrets: inherit\n");
  expect(inherited).toContain("    secrets: inherit\n");
  expect(differencesOf("site", withSiteCaller("ci.yml", inherited)).map(({ kind, name }) => [kind, name])).toEqual([["differs", "ci.yml"]]);
});

test("a caller that passes a secret its v3 shared workflow does not declare, such as PRODUCTION_DEPLOY_KEY to site-ci, fails here", () => {
  for (const { name, text } of callers()) expect([name, passedSecrets(text).filter((secret) => !declaredSecrets(text).includes(secret))]).toEqual([name, []]);
  const spare = `${siteCaller("ci.yml")}      PRODUCTION_DEPLOY_KEY: \${{ secrets.PRODUCTION_DEPLOY_KEY }}\n`;
  expect(passedSecrets(spare)).toContain("PRODUCTION_DEPLOY_KEY");
  expect(differencesOf("site", withSiteCaller("ci.yml", spare)).map(({ kind, name }) => [kind, name])).toEqual([["differs", "ci.yml"]]);
});

test("a caller missing a secret its v3 shared workflow declares, such as production without PRODUCTION_DEPLOY_KEY, fails here", () => {
  for (const { name, text } of callers()) {
    const secrets = callerJob(text)["secrets"];
    const passed = isRecord(secrets) ? secrets : {};
    expect([name, passed]).toEqual([name, Object.fromEntries(declaredSecrets(text).map((secret) => [secret, `\${{ secrets.${secret} }}`]))]);
  }
  const missing = siteCaller("production.yml").replace("      PRODUCTION_DEPLOY_KEY: ${{ secrets.PRODUCTION_DEPLOY_KEY }}\n", "");
  expect(passedSecrets(missing)).toEqual(["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]);
  expect(differencesOf("site", withSiteCaller("production.yml", missing)).map(({ kind, name }) => [kind, name])).toEqual([["differs", "production.yml"]]);
});
