import { expect, test } from "bun:test";
import { Effect } from "effect";
import { NO_CALLER_OPTIONS } from "../../../src/delivery/caller-options.ts";
import { ciJobsOf, DEFAULT_CI_JOBS } from "../../../src/delivery/ci-jobs.ts";
import { fullActions } from "../../../src/delivery/full-set/actions.ts";
import { MUTATION_WORKFLOW } from "../../../src/delivery/full-set/mutation.ts";
import { CHECKOUT, DOWNLOAD, UPLOAD } from "../../../src/delivery/full-set/steps.ts";
import { findStepFaults } from "../../../src/delivery/plain-steps.ts";
import { remoteCallsOf } from "../../../src/delivery/remote-calls.ts";
import { callerSetOf } from "../../../src/delivery/site-names.ts";
import { byHandSet, differencesOf, requiredSet, type WorkflowFile } from "../../../src/delivery/workflow-set.ts";
import { EXPRESSION, evaluated, jobRuns, truthy, type Plain } from "../../lib/workflow-expressions.ts";
import { isRecord } from "../../../src/delivery/workflow-references.ts";
import type { CallerSet } from "../../../src/delivery/site-names.ts";

const CODE: CallerSet = { kind: "code", ci: DEFAULT_CI_JOBS.code, options: NO_CALLER_OPTIONS };
const SITE: CallerSet = { kind: "site", names: { pages: "acme", domain: "acme.example", production: "acme/acme.example" }, ci: DEFAULT_CI_JOBS.site, options: NO_CALLER_OPTIONS };
const CHECKED: CallerSet = { kind: "code", ci: DEFAULT_CI_JOBS.code, options: { ...NO_CALLER_OPTIONS, checkRelease: true } };

const EVERY_OPTION: CallerSet = {
  kind: "code",
  ci: { tests: DEFAULT_CI_JOBS.code.tests.map((job) => ({ ...job, runsOn: "ubuntu-latest" })) },
  options: {
    advisoriesCron: "21 5 * * 1",
    flake: { nodeVersionFile: ".node-version" },
    flakeCron: "23 5 * * 1",
    pages: { build: "bun run docs:build", path: "docs/.vitepress/dist" },
    docsBuild: false,
    secretsPack: true,
    fullTest: true,
    claudeVersion: undefined,
    publishWorkspaces: false,
    checkRelease: false,
    publishes: true,
    publicRepository: true,
    releaseVersionInput: false,
    releaseAssets: true,
    platformPackages: undefined,
  },
};

const PACKAGED: CallerSet = { ...EVERY_OPTION, options: { ...EVERY_OPTION.options, releaseAssets: false, platformPackages: { binary: "acme", platforms: ["darwin-arm64", "linux-x64"] } } };

const FIXTURES = new URL("../../fixtures/workflows/", import.meta.url);

const written = (set: CallerSet): readonly WorkflowFile[] => [...requiredSet(set, false), ...byHandSet(set, false)];

const everyFile = (): readonly WorkflowFile[] => [CODE, SITE, CHECKED, EVERY_OPTION].flatMap(written);

const textOf = (set: CallerSet, name: string): string => written(set).find((file) => file.name === name)?.text ?? "no " + name;

const parsedRecord = (text: string): Record<string, unknown> => {
  const document = Bun.YAML.parse(text);
  return isRecord(document) ? document : {};
};

const documentOf = (set: CallerSet, name: string): Record<string, unknown> => parsedRecord(textOf(set, name));

const jobsOf = (document: Record<string, unknown>): Record<string, Record<string, unknown>> => {
  const jobs = document["jobs"];
  return isRecord(jobs) ? Object.fromEntries(Object.entries(jobs).flatMap(([name, job]) => (isRecord(job) ? [[name, job]] : []))) : {};
};

const stepsOf = (job: Record<string, unknown>): readonly Record<string, unknown>[] => {
  const steps = job["steps"];
  return Array.isArray(steps) ? steps.filter(isRecord) : [];
};

const withFile = (set: CallerSet, name: string, text: string): readonly WorkflowFile[] => requiredSet(set, false).map((file) => (file.name === name ? { name, text } : file));

const changed = (set: CallerSet, name: string, text: string): readonly (readonly string[])[] =>
  differencesOf(set, withFile(set, name, text), false).map(({ kind, name: file }) => [kind, file]);

test("both workflow sets require mutation and the whole-tree run", () => {
  expect(requiredSet(CODE, false).map(({ name }) => name)).toEqual(["ci.yml", "pr-title.yml", "main.yml", "release.yml", "mutation.yml", "whole-tree-run.yml"]);
  expect(requiredSet(SITE, false).map(({ name }) => name)).toEqual(["ci.yml", "pr-title.yml", "preview-close.yml", "main.yml", "release.yml", "production.yml", "mutation.yml", "whole-tree-run.yml"]);
  for (const set of [CODE, SITE]) expect(documentOf(set, "whole-tree-run.yml")["on"]).toEqual({ workflow_dispatch: null });
});

test("mutation is never both required and optional, and stays optional only in the kit", () => {
  for (const [set, kit, names] of [[CODE, false, ["advisories.yml", "flake.yml"]], [SITE, false, ["advisories.yml"]], [CODE, true, ["advisories.yml", "mutation.yml", "flake.yml"]]] as const) {
    const required = requiredSet(set, kit);
    const optional = byHandSet(set, kit);
    expect(optional.map(({ name }) => name)).toEqual([...names]);
    expect(optional.filter(({ name }) => required.some((file) => file.name === name))).toEqual([]);
  }
  const kit = requiredSet(CODE, true);
  expect(kit.map(({ name }) => name)).not.toContain("mutation.yml");
  expect(kit.map(({ name }) => name)).not.toContain("whole-tree-run.yml");
  expect(differencesOf(CODE, kit, true)).toEqual([]);
  expect(differencesOf(CODE, [...kit, { name: "mutation.yml", text: MUTATION_WORKFLOW }], true)).toEqual([]);
});

test("whole-tree tests install site and carried browsers before testing, without calling an absent action", () => {
  const carried: CallerSet = { ...CODE, ci: { tests: CODE.ci.tests.map((job) => ({ ...job, browsers: "firefox chromium" })) } };
  const carriedSite: CallerSet = { ...SITE, ci: carried.ci };
  for (const [set, browsers] of [[CODE, ""], [SITE, "chromium webkit"], [carried, "firefox chromium"], [carriedSite, "chromium webkit firefox"]] as const) {
    const steps = stepsOf(jobsOf(documentOf(set, "whole-tree-run.yml"))["tests"] ?? {});
    const install = steps.findIndex((step) => step["uses"] === "./.github/actions/playwright");
    const run = steps.findIndex((step) => step["run"] === "bunx checks-ci whole-tree tests");
    expect(run).toBeGreaterThan(0);
    if (browsers === "") {
      expect(install).toBe(-1);
    } else {
      expect(install).toBeGreaterThan(steps.findIndex((step) => step["uses"] === "./.github/actions/setup"));
      expect(install).toBeLessThan(run);
      expect(steps[install]).toEqual({ uses: "./.github/actions/playwright", with: { browsers } });
      expect(fullActions(set).some(({ path }) => path === ".github/actions/playwright/action.yml")).toBe(true);
    }
  }
});

test("whole-tree jobs keep the shared action pins and visibility runner instead of drifting", () => {
  for (const base of [CODE, SITE]) {
    for (const publicRepository of [false, true]) {
      const set = { ...base, options: { ...base.options, publicRepository } };
      const jobs = jobsOf(documentOf(set, "whole-tree-run.yml"));
      for (const name of ["tests", "gates", "report"]) {
        const job = jobs[name] ?? {};
        expect(job["runs-on"]).toBe(publicRepository ? "ubuntu-latest" : "${{ vars.CI_RUNS_ON || 'ubuntu-latest' }}");
        const uses = stepsOf(job).map((step) => step["uses"]).filter((use) => typeof use === "string" && !use.startsWith("./"));
        expect(uses).toEqual((name === "report" ? [CHECKOUT, DOWNLOAD, DOWNLOAD, DOWNLOAD, UPLOAD] : [CHECKOUT, UPLOAD]).map((pin) => pin.split(" ")[0]));
      }
    }
  }
});

test("a public repository's set holds pr-text.yml for both kinds and the kit, so a public repository without the scan workflow fails here", () => {
  const visible = (set: CallerSet): CallerSet => ({ ...set, options: { ...set.options, publicRepository: true } });
  for (const set of [CODE, SITE]) {
    for (const kit of [false, true]) {
      expect([set.kind, kit, requiredSet(visible(set), kit).some(({ name }) => name === "pr-text.yml")]).toEqual([set.kind, kit, true]);
      expect([set.kind, kit, requiredSet(set, kit).some(({ name }) => name === "pr-text.yml")]).toEqual([set.kind, kit, false]);
    }
  }
});

test("configured tier shards keep the aggregate checks job and pull request selection", () => {
  const set: CallerSet = { ...CODE, testTierShards: { e2e: 2 } };
  const jobs = jobsOf(documentOf(set, "ci.yml"));
  expect(jobs["e2e"]?.["strategy"]).toEqual({ "fail-fast": false, matrix: { shard: [1, 2] } });
  expect(stepsOf(jobs["e2e"] ?? {}).find((step) => step["id"] === "test")?.["run"]).toContain("--pr --tier=e2e --shard=${{ matrix.shard }}/2");
  expect(jobs["checks"]?.["needs"]).toContain("e2e");
});

test("the two kinds share pr-title and release byte for byte, so neither drifts between sites and code", () => {
  expect(textOf(SITE, "pr-title.yml")).toBe(textOf(CODE, "pr-title.yml"));
  expect(textOf(SITE, "release.yml")).toBe(textOf(CODE, "release.yml"));
  expect(textOf(SITE, "ci.yml")).not.toBe(textOf(CODE, "ci.yml"));
});

test("a ci.yml without a push-to-main trigger in any set fails here, so a merge that skipped the branch update gets no main run", () => {
  for (const set of [CODE, SITE, CHECKED, EVERY_OPTION]) expect(documentOf(set, "ci.yml")).toMatchObject({ on: { push: { branches: ["main"] } } });
});

test("body-only edits neither run nor cancel title checks, while title edits and pushes share a cancellation group", async () => {
  const generated = [CODE, SITE, CHECKED, EVERY_OPTION].flatMap((set) =>
    [false, true].map((kit) => parsedRecord(requiredSet(set, kit).find(({ name }) => name === "pr-title.yml")?.text ?? "")),
  );
  const workflows = [...generated, parsedRecord(await Bun.file(".github/workflows/pr-title.yml").text())];
  for (const workflow of workflows) {
    const condition = jobsOf(workflow)["title"]?.["if"];
    expect(typeof condition).toBe("string");
    const concurrency = workflow["concurrency"];
    expect(concurrency).toMatchObject({ "cancel-in-progress": true });
    const group = isRecord(concurrency) ? concurrency["group"] : undefined;
    expect(typeof group).toBe("string");
    const runs = (event: Plain): boolean => truthy(evaluated(String(condition), { github: { event } }));
    const groupOf = (event: { readonly [key: string]: Plain }, runId: string, number = "42"): string =>
      String(group).replace(/\$\{\{([\s\S]*?)\}\}/g, (_match: string, expression: string) =>
        evaluated(expression, { github: { event: { ...event, pull_request: { number } }, run_id: runId } }).coerceString(),
      );
    const push = { action: "synchronize" };
    const bodyEdit = { action: "edited", changes: { body: { from: "old body" } } };
    const titleEdit = { action: "edited", changes: { title: { from: "old title" } } };
    const combinedEdit = { action: "edited", changes: { ...bodyEdit.changes, ...titleEdit.changes } };
    const pushGroup = groupOf(push, "100");
    expect(runs(bodyEdit)).toBe(false);
    expect(groupOf(bodyEdit, "101")).not.toBe(pushGroup);
    expect(groupOf(bodyEdit, "101")).not.toBe(groupOf(bodyEdit, "102"));
    expect(groupOf(push, "103", "43")).not.toBe(pushGroup);
    for (const event of [titleEdit, combinedEdit, { action: "opened" }, { action: "reopened" }, push]) {
      expect(runs(event)).toBe(true);
      expect(groupOf(event, "104")).toBe(pushGroup);
    }
  }
});

test("an absent optional file is no difference, but a modified mutation workflow fails in either set", () => {
  const required = requiredSet(CODE, false);
  expect(differencesOf(CODE, required, false)).toEqual([]);
  expect(byHandSet(SITE, false).map(({ name }) => name)).toEqual(["advisories.yml"]);
  const handRolled = { name: "mutation.yml", text: "name: mutation\non:\n  workflow_dispatch:\n" };
  expect(differencesOf(CODE, [...required, handRolled], false).map(({ kind, name }) => [kind, name])).toEqual([["differs", "mutation.yml"]]);
  expect(differencesOf(SITE, [...requiredSet(SITE, false), handRolled], false).map(({ kind, name }) => [kind, name])).toEqual([["differs", "mutation.yml"]]);
  expect(textOf(CODE, "mutation.yml")).toBe(MUTATION_WORKFLOW);
});

test("a written file that calls another repository's workflow, or an action at a tag instead of a full commit SHA, fails here", () => {
  const held = everyFile().map(({ name, text }) => ({ path: ".github/workflows/" + name, document: Bun.YAML.parse(text), text }));
  expect(remoteCallsOf(held)).toEqual([]);
  const uses = everyFile().flatMap(({ text }) => Object.values(jobsOf(parsedRecord(text))).flatMap((job) => [job["uses"], ...stepsOf(job).map((step) => step["uses"])]));
  const named = uses.filter((use): use is string => typeof use === "string");
  expect(named.length).toBeGreaterThan(0);
  expect(named.filter((use) => !use.startsWith("./") && !/@[0-9a-f]{40}$/.test(use))).toEqual([]);
});

test("a written run step checks-plain-steps refuses, such as a test command an expression names only at run time, fails here", () => {
  const files = [CODE, SITE, CHECKED, EVERY_OPTION].flatMap((set) => [
    ...written(set).map(({ name, text }) => ({ path: ".github/workflows/" + name, text })),
    ...fullActions(set).filter(({ path }) => path.endsWith(".yml")),
  ]);
  expect(findStepFaults(files.map(({ path, text }) => ({ path, text, document: Bun.YAML.parse(text) })))).toEqual([]);
});

test("a ci.yml that omits ready_for_review never starts when a draft is marked ready, so the draft hold never releases", () => {
  for (const set of [CODE, SITE]) expect(documentOf(set, "ci.yml")).toMatchObject({ on: { pull_request: { types: expect.arrayContaining(["ready_for_review"]) } } });
});

test("a workflow that grants more than contents: read to every job, or a job that names no scopes of its own, fails here", () => {
  for (const { name, text } of everyFile()) {
    const workflow = parsedRecord(text);
    expect([name, workflow["permissions"]]).toEqual([name, { contents: "read" }]);
    for (const [job, body] of Object.entries(jobsOf(workflow))) expect([name, job, isRecord(body["permissions"])]).toEqual([name, job, true]);
  }
});

test("the whole-tree run queues concurrent runs, and a main release job does not cancel a pending release", () => {
  const grouped = (set: CallerSet): readonly string[] => written(set).filter(({ text }) => parsedRecord(text)["concurrency"] !== undefined).map(({ name }) => name);
  expect(grouped(CODE)).toEqual(["ci.yml", "pr-title.yml", "mutation.yml", "whole-tree-run.yml"]);
  expect(grouped(SITE)).toEqual(["ci.yml", "pr-title.yml", "mutation.yml", "whole-tree-run.yml"]);
  for (const set of [CODE, SITE]) {
    expect(documentOf(set, "whole-tree-run.yml")["concurrency"]).toEqual({ group: "whole-tree-run", "cancel-in-progress": false });
    expect(jobsOf(documentOf(set, "main.yml"))["release"]).toMatchObject({ concurrency: { "cancel-in-progress": false } });
  }
});

test("a written file that hands every secret to a job with secrets: inherit fails here", () => {
  for (const { name, text } of everyFile()) expect([name, text.includes("secrets: inherit")]).toEqual([name, false]);
});

test("a site file that reads a site name its env does not set, or sets another value than the set names, fails here", () => {
  const values: Readonly<Record<string, string>> = { SITE_PAGES: "acme", SITE_DOMAIN: "acme.example", SITE_PRODUCTION: "acme/acme.example" };
  for (const { name, text } of written(SITE)) {
    const document = parsedRecord(text);
    const env = isRecord(document["env"]) ? document["env"] : {};
    const read = [...new Set([...text.matchAll(/env\.(SITE_[A-Z]+)/g)].map((match) => match[1] ?? ""))];
    expect([name, Object.fromEntries(read.map((key) => [key, env[key]]))]).toEqual([name, Object.fromEntries(read.map((key) => [key, values[key]]))]);
  }
  expect(written(CODE).filter(({ text }) => text.includes("SITE_")).map(({ name }) => name)).toEqual([]);
});

test("every option lands in the file that uses it, so a pack lint without the secret or a publish without the full suite fails here", () => {
  expect(stepsOf(jobsOf(documentOf(EVERY_OPTION, "ci.yml"))["static"] ?? {})).toContainEqual(
    expect.objectContaining({ env: { PACK: EXPRESSION + "{{ secrets.CHECKS_SECRETS_PACK }}" }, run: "bunx checks-ci secrets-pack" }),
  );
  expect(stepsOf(jobsOf(documentOf(EVERY_OPTION, "main.yml"))["suite"] ?? {}).map((step) => step["run"])).toContain("bun run test --full");
  expect(stepsOf(jobsOf(documentOf(CODE, "main.yml"))["release"] ?? {}).map((step) => step["run"])).not.toContain("bun run test --full");
  expect(documentOf(EVERY_OPTION, "advisories.yml")).toMatchObject({ on: { schedule: [{ cron: "21 5 * * 1" }] } });
  expect(stepsOf(jobsOf(documentOf(EVERY_OPTION, "flake.yml"))["flake"] ?? {})).toContainEqual(expect.objectContaining({ with: { "node-version-file": ".node-version" } }));
  const docs = documentOf(EVERY_OPTION, "docs.yml");
  expect(docs).toMatchObject({ on: { push: { branches: ["main"] } } });
  expect(stepsOf(jobsOf(docs)["build"] ?? {})).toContainEqual({ run: "bun run docs:build" });
  expect(stepsOf(jobsOf(docs)["build"] ?? {})).toContainEqual(expect.objectContaining({ with: { path: "docs/.vitepress/dist" } }));
});

test("a set written with every option reads back as the same set, so a check right after --write never reports the file it just wrote", () => {
  for (const set of [EVERY_OPTION, PACKAGED, CHECKED, SITE]) {
    const files = written(set);
    const held = files.map(({ name, text }) => ({ path: ".github/workflows/" + name, document: Bun.YAML.parse(text), text }));
    const reread = Effect.runSync(callerSetOf(held, {}, "checks-workflows --write", set.options.fullTest, false, set.options.checkRelease, set.options.publicRepository, false, undefined, set.options.releaseAssets, set.options.platformPackages, undefined, undefined, set.options.flakeCron));
    expect(reread).toEqual(set);
    expect(differencesOf(reread, files, false)).toEqual([]);
  }
});

test("the releaseAssets option adds only the assets job and the tag output to main.yml, so a repository without it gets every other file unchanged", () => {
  const without: CallerSet = { ...EVERY_OPTION, options: { ...EVERY_OPTION.options, releaseAssets: false } };
  const before = new Map(written(without).map(({ name, text }) => [name, text]));
  const after = written(EVERY_OPTION);
  expect(after.map(({ name }) => name)).toEqual([...before.keys()]);
  expect(after.filter(({ name, text }) => before.get(name) !== text).map(({ name }) => name)).toEqual(["main.yml"]);
  expect(Object.keys(jobsOf(documentOf(without, "main.yml")))).toEqual(["suite", "release"]);
  expect(jobsOf(documentOf(without, "main.yml"))["release"]?.["outputs"]).toBeUndefined();
});

test("the assets job builds on Linux x64 and macOS arm64 from the released tag and each runner uploads only its own release-assets/ with contents: write only, so the script must name every compiled and SHA-256 file for its platform, and a job that runs without a release or holds a wider token fails here", () => {
  const jobs = jobsOf(documentOf(EVERY_OPTION, "main.yml"));
  expect(Object.keys(jobs)).toEqual(["suite", "release", "assets"]);
  expect(jobs["release"]?.["outputs"]).toEqual({ tag: EXPRESSION + "{{ steps.release.outputs.tag }}" });
  expect(stepsOf(jobs["release"] ?? {})).toContainEqual(expect.objectContaining({ id: "release", run: "bunx checks-release-tag" }));
  const assets = jobs["assets"] ?? {};
  expect(assets).toMatchObject({
    needs: "release",
    "runs-on": EXPRESSION + "{{ matrix.runner }}",
    strategy: { matrix: { runner: ["ubuntu-latest", "macos-latest"] } },
    permissions: { contents: "write" },
  });
  expect(Object.keys(isRecord(assets["permissions"]) ? assets["permissions"] : {})).toEqual(["contents"]);
  const runs = (tag: string, suite: string, release = "success"): boolean =>
    jobRuns(String(assets["if"]), { needs: { suite: { result: suite }, release: { result: release, outputs: { tag } } } }, suite === "success" && release === "success");
  expect(runs("", "success")).toBe(false);
  expect(runs("v1.4.0", "success")).toBe(true);
  expect(runs("v1.4.0", "skipped")).toBe(true);
  expect(runs("v1.4.0", "success", "failure")).toBe(false);
  const tagged = EXPRESSION + "{{ needs.release.outputs.tag }}";
  expect(stepsOf(assets)).toEqual([
    expect.objectContaining({ with: { ref: tagged, "persist-credentials": false } }),
    { uses: "./.github/actions/setup" },
    expect.objectContaining({ run: "bun run release:assets" }),
    expect.objectContaining({ env: { GH_TOKEN: EXPRESSION + "{{ github.token }}", TAG: tagged }, run: 'gh release upload "$TAG" release-assets/* --clobber' }),
  ]);
});

test("main.yml without platformPackages is byte for byte the file written before the option existed, so leaving it off never adds a binaries job, a download step or a release step variable", async () => {
  expect(textOf(CODE, "main.yml")).toBe(await Bun.file(new URL("main-unpublished.yml", FIXTURES)).text());
  expect(textOf(EVERY_OPTION, "main.yml")).toBe(await Bun.file(new URL("main-with-assets.yml", FIXTURES)).text());
});

test("the platformPackages option changes only main.yml, so it cannot reach ci.yml, release.yml or another file of the set", () => {
  const without: CallerSet = { ...PACKAGED, options: { ...PACKAGED.options, platformPackages: undefined } };
  const before = new Map(written(without).map(({ name, text }) => [name, text]));
  const after = written(PACKAGED);
  expect(after.map(({ name }) => name)).toEqual([...before.keys()]);
  expect(after.filter(({ name, text }) => before.get(name) !== text).map(({ name }) => name)).toEqual(["main.yml"]);
});

test("the binaries job builds each named platform on its own runner from the release commit and the release job publishes only after it, so a failed build never publishes a main package that names a missing platform package", () => {
  const jobs = jobsOf(documentOf(PACKAGED, "main.yml"));
  expect(Object.keys(jobs)).toEqual(["suite", "binaries", "release"]);
  const built = jobs["binaries"] ?? {};
  expect(built).toMatchObject({
    if: "startsWith(github.event.head_commit.message, 'chore: release ')",
    "runs-on": EXPRESSION + "{{ matrix.runner }}",
    strategy: { matrix: { runner: ["macos-latest", "ubuntu-latest"] } },
    permissions: { contents: "read" },
  });
  expect(stepsOf(built)).toEqual([
    expect.objectContaining({ with: { "persist-credentials": false } }),
    { uses: "./.github/actions/setup" },
    expect.objectContaining({ run: "bun run release:assets" }),
    expect.objectContaining({ with: { name: "platform-binary-" + EXPRESSION + "{{ matrix.runner }}", path: "release-assets/acme-*", "if-no-files-found": "error" } }),
  ]);
  const release = jobs["release"] ?? {};
  expect(release["needs"]).toEqual(["suite", "binaries"]);
  const runs = (suite: string, binaries: string): boolean => jobRuns(String(release["if"]), { needs: { suite: { result: suite }, binaries: { result: binaries } } }, suite === "success" && binaries === "success");
  expect(runs("success", "success")).toBe(true);
  expect(runs("skipped", "skipped")).toBe(true);
  expect(runs("success", "failure")).toBe(false);
  expect(runs("failure", "success")).toBe(false);
  const binaries = EXPRESSION + "{{ runner.temp }}/platform-binaries";
  expect(stepsOf(release).slice(-2)).toEqual([
    expect.objectContaining({ if: "needs.binaries.result == 'success'", with: { pattern: "platform-binary-*", "merge-multiple": true, path: binaries } }),
    { env: { GH_TOKEN: EXPRESSION + "{{ github.token }}", CHECKS_PLATFORM_BINARIES: binaries }, run: "bunx checks-release-tag" },
  ]);
});

test("each platform name maps to the GitHub-hosted runner of that operating system and processor, so an arm64 binary is never built on an x64 runner", () => {
  const every: CallerSet = { ...PACKAGED, options: { ...PACKAGED.options, platformPackages: { binary: "acme", platforms: ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"] } } };
  expect(jobsOf(documentOf(every, "main.yml"))["binaries"]?.["strategy"]).toEqual({ matrix: { runner: ["macos-latest", "macos-15-intel", "ubuntu-24.04-arm", "ubuntu-latest"] } });
});

test("a production.yml that names another domain than the set differs, so a site file cannot drift from its siblings", () => {
  const moved = textOf(SITE, "production.yml").replace("  SITE_DOMAIN: acme.example\n", "  SITE_DOMAIN: other.example\n");
  expect(moved).toContain("  SITE_DOMAIN: other.example\n");
  expect(changed(SITE, "production.yml", moved)).toEqual([["differs", "production.yml"]]);
});

type ReleaseContext = { readonly eventName: string; readonly refName: string; readonly headRef: string; readonly baseRef: string; readonly headRepo: string; readonly repository: string };

const githubOf = (ctx: ReleaseContext): Plain => ({
  event_name: ctx.eventName,
  ref_name: ctx.refName,
  head_ref: ctx.headRef,
  base_ref: ctx.baseRef,
  repository: ctx.repository,
  event: { pull_request: { head: { repo: { full_name: ctx.headRepo } } } },
});

const ciJobs = (set: CallerSet): Record<string, Record<string, unknown>> => jobsOf(documentOf(set, "ci.yml"));

const releaseRule = (): string => {
  const env = ciJobs(CODE)["changes"]?.["env"];
  return isRecord(env) && typeof env["RELEASE"] === "string" ? env["RELEASE"] : "no RELEASE";
};

const decidesReleaseRun = (ctx: ReleaseContext): boolean => truthy(evaluated(releaseRule(), { github: githubOf(ctx) }));

const gateSkips = (set: CallerSet): string => {
  const step = stepsOf(ciJobs(set)["checks"] ?? {}).find((one) => one["run"] === "bunx checks-ci require-success");
  const env = step?.["env"];
  return isRecord(env) && typeof env["SKIPS"] === "string" ? env["SKIPS"] : "no SKIPS";
};

test("the site ci.yml runs the browser job on the preview build and gates every job with always(), so a gate that skips on a failure or a browser job that does not wait for the build fails here", () => {
  const jobs = ciJobs(SITE);
  expect(Object.keys(jobs)).toEqual(["changes", "static", "site", "unit", "e2e", "browser", "checks"]);
  expect(jobs).toMatchObject({
    static: { needs: "changes" },
    site: { needs: "changes" },
    unit: { needs: "changes" },
    browser: { needs: "site", if: "needs.site.outputs.browser != 'false'" },
    e2e: { needs: "changes" },
    checks: { needs: ["changes", "static", "site", "unit", "e2e", "browser"] },
  });
  expect(jobs["changes"]).not.toHaveProperty("if");
  const siteGateIf = jobs["checks"]?.["if"];
  expect(typeof siteGateIf === "string" && truthy(evaluated(siteGateIf, {}))).toBe(true);
  expect(stepsOf(jobs["browser"] ?? {})).toContainEqual({ uses: "./.github/actions/playwright", with: { browsers: "webkit" } });
  expect(stepsOf(jobs["browser"] ?? {})).toContainEqual({ id: "test", run: "bunx checks-browser --pr" });
});

test("the code ci.yml runs tiered test steps without Playwright, so an untiered or browser-installing step fails here", () => {
  const jobs = ciJobs(CODE);
  expect(Object.keys(jobs)).toEqual(["changes", "static", "unit", "e2e", "checks"]);
  expect(jobs).toMatchObject({
    static: { needs: "changes" },
    unit: { needs: "changes", "runs-on": EXPRESSION + "{{ vars.CI_RUNS_ON || 'ubuntu-latest' }}" },
    e2e: { needs: "changes" },
    checks: { needs: ["changes", "static", "unit", "e2e"] },
  });
  const codeGateIf = jobs["checks"]?.["if"];
  expect(typeof codeGateIf === "string" && truthy(evaluated(codeGateIf, {}))).toBe(true);
  expect(stepsOf(jobs["unit"] ?? {})).toContainEqual({ id: "test", run: "bunx checks-test --pr --tier=unit" });
  expect(stepsOf(jobs["unit"] ?? {}).some((step) => step["uses"] === "./.github/actions/playwright")).toBe(false);
  expect(stepsOf(jobs["e2e"] ?? {})).toContainEqual({ id: "test", run: "bunx checks-test --pr --tier=e2e" });
  expect(stepsOf(jobs["e2e"] ?? {}).some((step) => step["uses"] === "./.github/actions/playwright")).toBe(false);
});

test("a ci.yml that writes the long release rule into a job other than changes, instead of reading its output, fails here", () => {
  const oneTest: CallerSet = { ...CODE, ci: { tests: CODE.ci.tests.slice(0, 1) } };
  const released: ReleaseContext = { eventName: "pull_request", refName: "release/main", headRef: "release/main", baseRef: "main", headRepo: "acme/acme", repository: "acme/acme" };
  const ordinary: ReleaseContext = { eventName: "pull_request", refName: "feature", headRef: "feature", baseRef: "main", headRepo: "acme/acme", repository: "acme/acme" };
  for (const set of [CODE, SITE, CHECKED, oneTest]) {
    const runsOnRelease = set.kind === "code" && set.options.checkRelease;
    const outputs = (release: boolean): Record<string, string> => ({
      release: String(release),
      "docs-only": "false",
      "tests-only": "false",
      ...(runsOnRelease ? { "check-release": String(release) } : {}),
    });
    for (const [name, job] of Object.entries(ciJobs(set))) {
      if (name === "changes") continue;
      const condition = typeof job["if"] === "string" ? job["if"] : "";
      if (condition === "" || condition === "always()") continue;
      const runsDespiteReleaseGithub = truthy(evaluated(condition, { github: githubOf(released), needs: { changes: { outputs: outputs(false) } } }));
      const runsOnReleaseOutput = truthy(evaluated(condition, { github: githubOf(ordinary), needs: { changes: { outputs: outputs(true) } } }));
      expect([name, runsDespiteReleaseGithub, runsOnReleaseOutput]).toEqual([name, true, runsOnRelease || job["needs"] === "site"]);
    }
  }
});

test("a fork pull request from a release/ branch still runs every job instead of skipping as the release run", () => {
  const release = { eventName: "pull_request", refName: "release/main", headRef: "release/main", baseRef: "main", headRepo: "acme/acme", repository: "acme/acme" };
  expect(decidesReleaseRun({ ...release, headRepo: "fork/acme" })).toBe(false);
  expect(decidesReleaseRun(release)).toBe(true);
  expect(decidesReleaseRun({ ...release, eventName: "PULL_REQUEST" })).toBe(true);
});

test("a release/ branch that does not match release/<base> still runs every job instead of skipping as the release run", () => {
  const run = { eventName: "pull_request", refName: "release/v2-prep", headRef: "release/v2-prep", baseRef: "main", headRepo: "acme/acme", repository: "acme/acme" };
  expect(decidesReleaseRun(run)).toBe(false);
  expect(decidesReleaseRun({ ...run, refName: "feature", headRef: "feature" })).toBe(false);
  expect(decidesReleaseRun({ ...run, eventName: "workflow_dispatch", refName: "release/main", headRef: "" })).toBe(true);
  expect(decidesReleaseRun({ ...run, eventName: "workflow_dispatch", refName: "main", headRef: "" })).toBe(false);
});

type Change = "release" | "docs-only" | "tests-only" | "tests-reach-route" | "no-route" | "full";

function skippedAndPassed(set: CallerSet, change: Change): readonly (readonly string[])[] {
  const checksRelease = set.kind === "code" && set.options.checkRelease;
  const outputs = {
    release: String(change === "release"),
    "docs-only": String(change === "docs-only"),
    "tests-only": String(change === "tests-only" || change === "tests-reach-route"),
    browser: String(change !== "tests-only" && change !== "no-route"),
    ...(checksRelease ? { "check-release": String(change === "release") } : {}),
  };
  const contexts = { needs: { changes: { outputs }, site: { outputs: { browser: outputs["browser"] } } } };
  const skipped: string[] = [];
  for (const [name, job] of Object.entries(ciJobs(set)).filter(([id]) => id !== "checks")) {
    const needs = job["needs"];
    const condition = job["if"];
    if ((typeof needs === "string" && skipped.includes(needs)) || (typeof condition === "string" && !truthy(evaluated(condition, contexts)))) skipped.push(name);
  }
  const skips = evaluated(gateSkips(set), contexts).coerceString();
  return [skipped, skips.split(" ").filter((job) => job !== "")];
}

test("on the release run every job but changes skips and the gate passes exactly those skips, unless the repository checks its release pull request", () => {
  expect(skippedAndPassed(SITE, "release")).toEqual([["static", "site", "unit", "e2e", "browser"], ["static", "site", "unit", "e2e", "browser"]]);
  expect(skippedAndPassed(CODE, "release")).toEqual([["static", "unit", "e2e"], ["static", "unit", "e2e"]]);
  expect(skippedAndPassed(CHECKED, "release")).toEqual([[], []]);
});

test("a docs-only change skips the site and test jobs and a tests-only one skips the site build, and the gate passes exactly those skips", () => {
  expect(skippedAndPassed(SITE, "docs-only")).toEqual([["site", "unit", "e2e", "browser"], ["site", "unit", "e2e", "browser"]]);
  expect(skippedAndPassed(CODE, "docs-only")).toEqual([["unit", "e2e"], ["unit", "e2e"]]);
  expect(skippedAndPassed(CHECKED, "docs-only")).toEqual([["unit", "e2e"], ["unit", "e2e"]]);
  expect(skippedAndPassed(SITE, "tests-only")).toEqual([["site", "browser"], ["site", "browser"]]);
  expect(skippedAndPassed(CODE, "tests-only")).toEqual([[], []]);
  for (const set of [SITE, CODE, CHECKED]) expect(skippedAndPassed(set, "full")).toEqual([[], []]);
});

test("a change that reaches no route skips the browser job, not the site build", () => {
  expect(skippedAndPassed(SITE, "no-route")).toEqual([["browser"], ["browser"]]);
  expect(skippedAndPassed(SITE, "tests-reach-route")).toEqual([["site", "browser"], ["site", "browser"]]);
});

test("site workflows do not add a screenshot job or delete a carried one", async () => {
  const options = { publicRepository: true, docsBuild: false, hasE2e: true };
  const fresh = await Effect.runPromise(ciJobsOf("site", undefined, options));
  expect(fresh.tests.map(({ name }) => name)).toEqual(["unit", "e2e", "browser"]);
  const document = { jobs: { screens: { "runs-on": "ubuntu-latest", steps: [{ id: "test", run: "bunx checks-test --pr-screens" }] } } };
  const held = await Effect.runPromise(ciJobsOf("site", { path: ".github/workflows/ci.yml", document, text: "" }, options));
  expect(held.tests.map(({ name, run }) => ({ name, run }))).toEqual([{ name: "screens", run: "bunx checks-test --pr-screens" }]);
});

test("a docs-only pull request that skips the docs build or lets its failure pass the gate fails here", () => {
  for (const base of [CODE, SITE, CHECKED]) {
    const set = { ...base, options: { ...base.options, docsBuild: true } };
    const jobs = ciJobs(set);
    expect(jobs["docs"]).toMatchObject({ needs: "changes" });
    expect(stepsOf(jobs["docs"] ?? {})).toContainEqual({ run: "bun run docs:build" });
    expect(jobs["checks"]?.["needs"]).toContain("docs");
    expect(skippedAndPassed(set, "docs-only")[0]).not.toContain("docs");
    expect(skippedAndPassed(set, "docs-only")[1]).not.toContain("docs");
    expect(skippedAndPassed(set, "release")[0]).toEqual(skippedAndPassed(set, "release")[1]);
  }
  expect(ciJobs(CODE)).not.toHaveProperty("docs");
});

const heldCi = (document: unknown) => ({ path: ".github/workflows/ci.yml", document, text: JSON.stringify(document) });

const setOfCi = (document: unknown): CallerSet => Effect.runSync(callerSetOf([heldCi(document)], {}, "checks-workflows --write", false, false, false, false, false));

const faultOfCi = (document: unknown): string => Effect.runSync(Effect.flip(callerSetOf([heldCi(document)], {}, "checks-workflows --write", false, false, false, false, false))).message;

const withE2e = (name: string, edit: (job: Record<string, unknown>) => Record<string, unknown> = (job) => job): Record<string, unknown> => {
  const document = documentOf(CODE, "ci.yml");
  const jobs = jobsOf(document);
  const unit = jobs["unit"] ?? {};
  const e2e = {
    ...unit,
    needs: "unit",
    "runs-on": "macos-latest",
    steps: [
      ...stepsOf(unit).filter((step) => step["id"] !== "test"),
      { uses: "./.github/actions/playwright", with: { browsers: "chromium webkit" } },
      { id: "test", run: "bun run test:e2e" },
    ],
  };
  const lint = { "runs-on": "ubuntu-latest", steps: [{ run: "bun run lint" }] };
  return { ...document, jobs: { ...jobs, [name]: edit(e2e), lint } };
};

test("a write keeps a test job added to ci.yml with its command, browsers and runner, and drops its hand-added needs and a job with no test step", () => {
  const set = setOfCi(withE2e("e2e"));
  expect(set.ci.tests.map(({ name }) => name)).toEqual(["unit", "e2e"]);
  const jobs = ciJobs(set);
  expect(Object.keys(jobs)).toEqual(["changes", "static", "unit", "e2e", "checks"]);
  expect(jobs["e2e"]).toMatchObject({ needs: "changes", "runs-on": "macos-latest" });
  const keptIf = jobs["e2e"]?.["if"];
  const keptOutputs = { release: "false", "docs-only": "false", "tests-only": "false" };
  expect(typeof keptIf === "string" && truthy(evaluated(keptIf, { needs: { changes: { outputs: keptOutputs } } }))).toBe(true);
  expect(typeof keptIf === "string" && truthy(evaluated(keptIf, { needs: { changes: { outputs: { ...keptOutputs, release: "true" } } } }))).toBe(false);
  expect(stepsOf(jobs["e2e"] ?? {})).toContainEqual({ uses: "./.github/actions/playwright", with: { browsers: "chromium webkit" } });
  expect(stepsOf(jobs["e2e"] ?? {})).toContainEqual({ id: "test", run: "bun run test:e2e" });
  expect(jobs["checks"]).toMatchObject({ needs: ["changes", "static", "unit", "e2e"] });
  const text = textOf(set, "ci.yml");
  expect(textOf(setOfCi(Bun.YAML.parse(text)), "ci.yml")).toBe(text);
});

test("a ci.yml whose release test step picks its command by an expression is rewritten to checks-ci test, instead of keeping the step checks-plain-steps refuses", () => {
  const document = documentOf(CHECKED, "ci.yml");
  const jobs = jobsOf(document);
  const unit = jobs["unit"] ?? {};
  const expressionRun = EXPRESSION + "{{ needs.changes.outputs.check-release == 'true' && 'bun run test' || 'bunx checks-test --pr' }}";
  const steps = stepsOf(unit).map((step) => (step["id"] === "test" ? { id: "test", run: expressionRun } : step));
  const held = { ...document, jobs: { ...jobs, unit: { ...unit, steps } } };
  const reread = Effect.runSync(callerSetOf([heldCi(held)], {}, "checks-workflows --write", false, false, true, false, false));
  expect(reread).toEqual(CHECKED);
  expect(stepsOf(ciJobs(reread)["unit"] ?? {})).toContainEqual({ id: "test", env: { CHECK_RELEASE: EXPRESSION + "{{ needs.changes.outputs.check-release }}", TEST_TIER: "unit" }, run: "bunx checks-ci test" });
});

test("a held docs test job is kept when docs:build is absent and refused when present, so only the written docs job takes the name", () => {
  const held = withE2e("docs");
  const kept = Effect.runSync(callerSetOf([heldCi(held)], {}, "checks-workflows --write", false, false, false, false, false));
  expect(kept.ci.tests.map(({ name }) => name)).toContain("docs");
  const fault = Effect.runSync(Effect.flip(callerSetOf([heldCi(held)], {}, "checks-workflows --write", false, false, false, false, true))).message;
  expect(fault).toBe(".github/workflows/ci.yml runs a test step in job docs, a name the written ci.yml gives its own job, so rename it");
});

test("a test job named like a fixed job or no job id, or one whose runner is not one label, is refused, so a write never drops it silently", () => {
  expect(faultOfCi(withE2e("site"))).toBe(".github/workflows/ci.yml runs a test step in job site, a name the written ci.yml gives its own job, so rename it");
  expect(faultOfCi(withE2e("e2e tests"))).toBe(".github/workflows/ci.yml holds test job e2e tests, a name the written ci.yml cannot give a test job, so rename it");
  expect(faultOfCi(withE2e("e2e", (job) => ({ ...job, "runs-on": ["self-hosted", "macos"] })))).toStartWith(".github/workflows/ci.yml job e2e is not a test job checks-workflows writes:");
});
