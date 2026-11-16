import { Evaluator, Lexer, Parser, data } from "@actions/expressions";
import { expect, test } from "bun:test";
import { Effect } from "effect";
import { NO_CALLER_OPTIONS } from "../../../src/delivery/caller-options.ts";
import { DEFAULT_CI_JOBS } from "../../../src/delivery/ci-jobs.ts";
import { callerSetOf } from "../../../src/delivery/site-names.ts";
import { byHandSet, differencesOf, holdsSingleJobCi, requiredSet } from "../../../src/delivery/workflow-set.ts";
import { isRecord } from "../../../src/delivery/workflow-references.ts";
import { MUTATION_WORKFLOW } from "../../../src/delivery/setup-workflow.ts";
import type { CallerSet } from "../../../src/delivery/site-names.ts";

const CODE: CallerSet = { kind: "code", ci: DEFAULT_CI_JOBS.code, options: NO_CALLER_OPTIONS };
const SITE: CallerSet = { kind: "site", names: { pages: "acme", domain: "acme.example", production: "acme/acme.example" }, ci: DEFAULT_CI_JOBS.site, options: NO_CALLER_OPTIONS };

test("the code set is ci, pr-title, main and release, and the site set adds preview-close and production", () => {
  expect(requiredSet(CODE).map(({ name }) => name)).toEqual(["ci.yml", "pr-title.yml", "main.yml", "release.yml"]);
  expect(requiredSet(SITE).map(({ name }) => name)).toEqual(["ci.yml", "pr-title.yml", "preview-close.yml", "main.yml", "release.yml", "production.yml"]);
});

test("the two kinds share pr-title and release byte for byte, so neither drifts between sites and code", () => {
  const code = new Map(requiredSet(CODE).map(({ name, text }) => [name, text]));
  const site = new Map(requiredSet(SITE).map(({ name, text }) => [name, text]));
  expect(site.get("pr-title.yml")).toBe(code.get("pr-title.yml") ?? "no pr-title.yml");
  expect(site.get("release.yml")).toBe(code.get("release.yml") ?? "no release.yml");
  expect(site.get("ci.yml")).not.toBe(code.get("ci.yml"));
});

test("an absent by-hand caller is no difference, but one that runs its own steps is", () => {
  const written = requiredSet(CODE);
  expect(differencesOf(CODE, written)).toEqual([]);
  expect(byHandSet(SITE).map(({ name }) => name)).toEqual(["advisories.yml"]);
  const handRolled = { name: "mutation.yml", text: "name: mutation\non:\n  workflow_dispatch:\n" };
  expect(differencesOf(CODE, [...written, handRolled]).map(({ kind, name }) => [kind, name])).toEqual([["differs", "mutation.yml"]]);
  expect(differencesOf(SITE, [...requiredSet(SITE), handRolled]).map(({ kind, name }) => [kind, name])).toEqual([["extra", "mutation.yml"]]);
});

const SHARED_V3_FILES = [
  "advisories.yml",
  "changes.yml",
  "gate.yml",
  "mutation.yml",
  "pr-title.yml",
  "preview-remove.yml",
  "release-main.yml",
  "release-pr.yml",
  "site-main.yml",
  "site-preview.yml",
  "site-production.yml",
  "static.yml",
  "test.yml",
];

test("no advisories, mutation or required caller pins below v3 or names a file outside the v3 shared workflows", () => {
  const callers = [...requiredSet(CODE), ...requiredSet(SITE), ...byHandSet(SITE), { name: "mutation.yml", text: MUTATION_WORKFLOW }];
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
  for (const set of [CODE, SITE]) {
    const ci = requiredSet(set).find(({ name }) => name === "ci.yml");
    const document = Bun.YAML.parse(ci?.text ?? "");
    const on = isRecord(document) ? document["on"] : undefined;
    const pullRequest = isRecord(on) ? on["pull_request"] : undefined;
    const types = isRecord(pullRequest) ? pullRequest["types"] : undefined;
    expect(types).toContain("ready_for_review");
  }
});

const CALLEE_GRANTS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "advisories.yml": { contents: "read", issues: "write" },
  "changes.yml": { contents: "read" },
  "static.yml": { contents: "read", actions: "write", statuses: "write", "pull-requests": "read" },
  "test.yml": { contents: "read", actions: "write" },
  "site-preview.yml": { contents: "read", "pull-requests": "write" },
  "gate.yml": { contents: "read", statuses: "write" },
  "mutation.yml": { contents: "read", actions: "write", "pull-requests": "write" },
  "pr-title.yml": { contents: "read", statuses: "write", "pull-requests": "read" },
  "preview-remove.yml": { contents: "read", "pull-requests": "write" },
  "release-main.yml": { contents: "write", "id-token": "write", actions: "read", "pull-requests": "read" },
  "release-pr.yml": { contents: "write", "pull-requests": "write", actions: "write" },
  "site-main.yml": { contents: "write", actions: "read", "pull-requests": "read" },
  "site-production.yml": { contents: "read", actions: "read", "pull-requests": "read" },
  "flake.yml": { contents: "read" },
  "github-pages.yml": { contents: "read", pages: "write", "id-token": "write" },
};

const callers = (): readonly { name: string; text: string }[] => [
  ...requiredSet(CODE),
  ...requiredSet(SITE),
  ...byHandSet(SITE),
  { name: "mutation.yml", text: MUTATION_WORKFLOW },
];

const callerJobs = (text: string): readonly Record<string, unknown>[] => {
  const document = Bun.YAML.parse(text);
  const jobs = isRecord(document) ? document["jobs"] : undefined;
  return isRecord(jobs) ? Object.values(jobs).filter(isRecord) : [];
};

const callerJob = (text: string): Record<string, unknown> => callerJobs(text)[0] ?? {};

const sharedFile = (job: Record<string, unknown>): string => String(job["uses"]).split("/").pop()?.replace(/@v3$/, "") ?? "";

test("each calling job grants exactly the scopes its v3 job declares, so a spare deployments: write or a missing actions: write fails here", () => {
  for (const { name, text } of callers()) {
    for (const job of callerJobs(text)) expect([name, sharedFile(job), job["permissions"]]).toEqual([name, sharedFile(job), CALLEE_GRANTS[sharedFile(job)]]);
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
  const codeMain = requiredSet(CODE).find(({ name }) => name === "main.yml");
  const codeDocument = Bun.YAML.parse(codeMain?.text ?? "");
  expect(isRecord(codeDocument) ? codeDocument["concurrency"] : undefined).toEqual({ group: "main", "cancel-in-progress": false });
  const siteMain = requiredSet(SITE).find(({ name }) => name === "main.yml");
  const siteDocument = Bun.YAML.parse(siteMain?.text ?? "");
  expect(isRecord(siteDocument) ? siteDocument["concurrency"] : undefined).toBeUndefined();
});

const CALLEE_SECRETS: Readonly<Record<string, readonly string[]>> = {
  "advisories.yml": [],
  "changes.yml": [],
  "static.yml": [],
  "test.yml": [],
  "site-preview.yml": ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
  "gate.yml": [],
  "mutation.yml": [],
  "pr-title.yml": [],
  "preview-remove.yml": ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
  "release-main.yml": [],
  "release-pr.yml": [],
  "site-main.yml": ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
  "site-production.yml": ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "PRODUCTION_DEPLOY_KEY"],
};

const jobSecrets = (job: Record<string, unknown>): readonly string[] => {
  const secrets = job["secrets"];
  return isRecord(secrets) ? Object.keys(secrets) : [];
};

const passedSecrets = (text: string): readonly string[] => callerJobs(text).flatMap(jobSecrets);

const declaredSecrets = (job: Record<string, unknown>): readonly string[] => CALLEE_SECRETS[sharedFile(job)] ?? ["no such shared workflow"];

const siteCaller = (name: string): string => requiredSet(SITE).find((file) => file.name === name)?.text ?? `no ${name}`;

const withSiteCaller = (name: string, text: string): readonly { name: string; text: string }[] =>
  requiredSet(SITE).map((file) => (file.name === name ? { name, text } : file));

test("a caller written with secrets: inherit passes nothing to a shared workflow of another organization, so it is drift", () => {
  for (const { name, text } of callers()) for (const job of callerJobs(text)) expect([name, job["secrets"]]).not.toEqual([name, "inherit"]);
  const inherited = siteCaller("ci.yml").replace(/ {4}secrets:\n(?: {6}.*\n)+/, "    secrets: inherit\n");
  expect(inherited).toContain("    secrets: inherit\n");
  expect(differencesOf(SITE, withSiteCaller("ci.yml", inherited)).map(({ kind, name }) => [kind, name])).toEqual([["differs", "ci.yml"]]);
});

test("a caller that passes a secret its v3 shared workflow does not declare, such as PRODUCTION_DEPLOY_KEY to site-preview, fails here", () => {
  for (const { name, text } of callers()) {
    for (const job of callerJobs(text)) expect([name, jobSecrets(job).filter((secret) => !declaredSecrets(job).includes(secret))]).toEqual([name, []]);
  }
  const account = "      CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}\n";
  const spare = siteCaller("ci.yml").replace(account, `${account}      PRODUCTION_DEPLOY_KEY: \${{ secrets.PRODUCTION_DEPLOY_KEY }}\n`);
  expect(passedSecrets(spare)).toContain("PRODUCTION_DEPLOY_KEY");
  expect(differencesOf(SITE, withSiteCaller("ci.yml", spare)).map(({ kind, name }) => [kind, name])).toEqual([["differs", "ci.yml"]]);
});

test("a caller missing a secret its v3 shared workflow declares, such as production without PRODUCTION_DEPLOY_KEY, fails here", () => {
  for (const { name, text } of callers()) {
    for (const job of callerJobs(text)) {
      const secrets = job["secrets"];
      const passed = isRecord(secrets) ? secrets : {};
      expect([name, passed]).toEqual([name, Object.fromEntries(declaredSecrets(job).map((secret) => [secret, `\${{ secrets.${secret} }}`]))]);
    }
  }
  const missing = siteCaller("production.yml").replace("      PRODUCTION_DEPLOY_KEY: ${{ secrets.PRODUCTION_DEPLOY_KEY }}\n", "");
  expect(passedSecrets(missing)).toEqual(["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]);
  expect(differencesOf(SITE, withSiteCaller("production.yml", missing)).map(({ kind, name }) => [kind, name])).toEqual([["differs", "production.yml"]]);
});

test("each site caller of a shared workflow that reads the site names passes pages, domain and production, and no other caller passes an input", () => {
  const passed = callers()
    .filter(({ name }) => name !== "ci.yml")
    .map(({ name, text }) => [String(callerJob(text)["uses"]).split("/").pop(), name, callerJob(text)["with"]]);
  const names = { pages: "acme", domain: "acme.example", production: "acme/acme.example" };
  expect(passed.filter(([, , inputs]) => inputs !== undefined)).toEqual([
    ["preview-remove.yml@v3", "preview-close.yml", names],
    ["site-main.yml@v3", "main.yml", names],
    ["site-production.yml@v3", "production.yml", names],
  ]);
});

const EVERY_OPTION: CallerSet = {
  kind: "code",
  ci: DEFAULT_CI_JOBS.code,
  options: {
    advisoriesCron: "21 5 * * 1",
    flake: { runs: "20", nodeVersionFile: ".node-version" },
    pages: { build: "bun run docs:build", path: "docs/.vitepress/dist" },
    secretsPack: true,
    fullTest: true,
  },
};

const everyOptionFiles = (): readonly { name: string; text: string }[] => [...requiredSet(EVERY_OPTION), ...byHandSet(EVERY_OPTION)];

const everyOptionFile = (name: string): unknown => Bun.YAML.parse(everyOptionFiles().find((file) => file.name === name)?.text ?? `no ${name}`);

const DECLARED_INPUTS: Readonly<Record<string, readonly string[]>> = {
  "advisories.yml": [],
  "changes.yml": ["paths"],
  "static.yml": ["hold", "secrets-pack"],
  "test.yml": ["run", "browsers", "artifact", "artifact-path", "heavy", "hold", "runs-on"],
  "gate.yml": ["results", "skips"],
  "release-main.yml": ["full-test"],
  "release-pr.yml": [],
  "pr-title.yml": [],
  "flake.yml": ["runs", "node-version-file"],
  "github-pages.yml": ["build", "path"],
};

test("a caller with every option passes only inputs its v3 shared workflow declares, so a misspelt full_test or secretsPack fails here", () => {
  const passed = everyOptionFiles()
    .filter(({ name }) => name !== "mutation.yml")
    .flatMap(({ name, text }) => callerJobs(text).map((job) => [name, sharedFile(job), Object.keys(isRecord(job["with"]) ? job["with"] : {})] as const));
  for (const [name, shared, inputs] of passed) {
    expect([name, shared, inputs.filter((input) => !(DECLARED_INPUTS[shared] ?? []).includes(input))]).toEqual([name, shared, []]);
  }
  for (const { text } of everyOptionFiles().filter(({ name }) => name === "flake.yml" || name === "docs.yml")) {
    for (const job of callerJobs(text)) expect(job["permissions"]).toEqual(CALLEE_GRANTS[sharedFile(job)]);
  }
});

test("every option lands where the shared-ci page puts it, so a pack lint without the secret or a publish without the full suite fails here", () => {
  expect(everyOptionFile("ci.yml")).toMatchObject({
    jobs: { static: { with: { "secrets-pack": true }, secrets: { CHECKS_SECRETS_PACK: "${{ secrets.CHECKS_SECRETS_PACK }}" } } },
  });
  expect(everyOptionFile("main.yml")).toMatchObject({ jobs: { release: { uses: PART("release-main.yml"), with: { "full-test": true } } } });
  expect(everyOptionFile("advisories.yml")).toMatchObject({ on: { schedule: [{ cron: "21 5 * * 1" }] } });
  expect(everyOptionFile("flake.yml")).toMatchObject({ on: { workflow_dispatch: null }, jobs: { flake: { with: { runs: "20", "node-version-file": ".node-version" } } } });
  const docs = everyOptionFile("docs.yml");
  expect(docs).toMatchObject({
    on: { push: { branches: ["main"] } },
    jobs: { pages: { uses: PART("github-pages.yml"), with: { build: "bun run docs:build", path: "docs/.vitepress/dist" } } },
  });
  expect(isRecord(docs) ? docs["concurrency"] : "no document").toBeUndefined();
});

test("a set written with every option reads back as the same set, so a check right after --write never reports the file it just wrote", () => {
  const written = everyOptionFiles();
  const held = written.map(({ name, text }) => ({ path: `.github/workflows/${name}`, document: Bun.YAML.parse(text), text }));
  const reread = Effect.runSync(callerSetOf(held, {}, "checks-workflows --write", true));
  expect(reread.options).toEqual(EVERY_OPTION.options);
  expect(differencesOf(reread, written)).toEqual([]);
});

test("a site caller that passes another domain than the one the set names differs, so a caller cannot drift from its siblings", () => {
  const moved = siteCaller("main.yml").replace('      domain: "acme.example"\n', '      domain: "other.example"\n');
  expect(moved).toContain('      domain: "other.example"\n');
  expect(differencesOf(SITE, withSiteCaller("main.yml", moved)).map(({ kind, name }) => [kind, name])).toEqual([["differs", "main.yml"]]);
});

const PART = (file: string): string => `avi2d/workflows/.github/workflows/${file}@v3`;
const NOT_RELEASED = "needs.changes.outputs.release != 'true'";
const CHANGED = `${NOT_RELEASED} && needs.changes.outputs.docs-only != 'true'`;
const RELEASE_RUN = "((github.event_name == 'workflow_dispatch' && startsWith(github.ref_name, 'release/')) || (github.event_name == 'pull_request' && github.head_ref == format('release/{0}', github.base_ref) && github.event.pull_request.head.repo.full_name == github.repository))";
const NOT_RELEASE = `\${{ !${RELEASE_RUN} }}`;
const LIBRARY: CallerSet = { kind: "code", ci: { ...DEFAULT_CI_JOBS.code, changes: false }, options: NO_CALLER_OPTIONS };

type ReleaseContext = { readonly eventName: string; readonly refName: string; readonly headRef: string; readonly baseRef: string; readonly headRepo: string; readonly repository: string };

type Plain = string | { readonly [key: string]: Plain };

const dictionaryOf = (record: { readonly [key: string]: Plain }): data.Dictionary =>
  new data.Dictionary(...Object.entries(record).map(([key, inner]) => ({ key, value: typeof inner === "string" ? new data.StringData(inner) : dictionaryOf(inner) })));

const githubOf = (ctx: ReleaseContext): Plain => ({
  event_name: ctx.eventName,
  ref_name: ctx.refName,
  head_ref: ctx.headRef,
  base_ref: ctx.baseRef,
  repository: ctx.repository,
  event: { pull_request: { head: { repo: { full_name: ctx.headRepo } } } },
});

const evaluated = (expression: string, contexts: Readonly<Record<string, Plain>>): data.ExpressionData => {
  const inner = expression.startsWith("${{") && expression.endsWith("}}") ? expression.slice(3, -2).trim() : expression;
  const parser = new Parser(new Lexer(inner).lex().tokens, Object.keys(contexts), []);
  return new Evaluator(parser.parse(), dictionaryOf(contexts)).evaluate();
};

const truthy = (result: data.ExpressionData): boolean => (result.kind === data.Kind.Boolean ? result.value : result.coerceString() !== "");

const conditionOf = (job: unknown): string => (isRecord(job) && typeof job["if"] === "string" ? job["if"] : "no if");

const decidesReleaseRun = (condition: string, ctx: ReleaseContext): boolean => !truthy(evaluated(condition, { github: githubOf(ctx) }));

const ciJobs = (set: CallerSet): Record<string, unknown> => {
  const ci = requiredSet(set).find(({ name }) => name === "ci.yml");
  const document = Bun.YAML.parse(ci?.text ?? "");
  const jobs = isRecord(document) ? document["jobs"] : undefined;
  return isRecord(jobs) ? jobs : {};
};

const ciText = (set: CallerSet): string => requiredSet(set).find(({ name }) => name === "ci.yml")?.text ?? "no ci.yml";

test("the default site ci.yml composes the jobs of the shared-ci site example, so a gate without always() or a browser job that does not wait for the preview fails here", () => {
  const jobs = ciJobs(SITE);
  expect(Object.keys(jobs)).toEqual(["changes", "static", "site", "unit", "browser", "checks"]);
  expect(jobs).toMatchObject({
    changes: { uses: PART("changes.yml") },
    static: { needs: "changes", if: NOT_RELEASED, uses: PART("static.yml"), with: { hold: false } },
    site: { needs: "changes", if: CHANGED, uses: PART("site-preview.yml"), with: { pages: "acme" } },
    unit: { needs: "changes", if: CHANGED, uses: PART("test.yml"), with: { hold: false } },
    browser: { needs: "site", uses: PART("test.yml"), with: { run: "bunx checks-browser --pr", browsers: "webkit", artifact: "site-dist", heavy: true } },
    checks: {
      needs: ["changes", "static", "site", "unit", "browser"],
      if: "always()",
      uses: PART("gate.yml"),
      with: {
        results: "${{ toJSON(needs) }}",
        skips: "${{ needs.changes.outputs.release == 'true' && 'static site unit browser' || needs.changes.outputs.docs-only == 'true' && 'site unit browser' || '' }}",
      },
    },
  });
  expect(jobs["changes"]).not.toHaveProperty("if");
  expect(jobs["browser"]).not.toHaveProperty("if");
  expect(jobs["browser"]).not.toHaveProperty(["with", "hold"]);
});

test("the default code ci.yml reads the release rule from the changes output as the shared-ci example does, and the gate passes the test job only when it skips on a docs-only change", () => {
  const jobs = ciJobs(CODE);
  expect(Object.keys(jobs)).toEqual(["changes", "static", "test", "checks"]);
  expect(jobs).toMatchObject({
    static: { needs: "changes", if: NOT_RELEASED, uses: PART("static.yml") },
    test: { needs: "changes", if: CHANGED, uses: PART("test.yml"), with: { "runs-on": "${{ vars.CI_RUNS_ON || 'ubuntu-latest' }}" } },
    checks: {
      needs: ["changes", "static", "test"],
      if: "always()",
      uses: PART("gate.yml"),
      with: { skips: "${{ needs.changes.outputs.release == 'true' && 'static test' || needs.changes.outputs.docs-only == 'true' && 'test' || '' }}" },
    },
  });
  expect(jobs["static"]).not.toHaveProperty("with");
  expect(jobs["test"]).not.toHaveProperty(["with", "hold"]);
});

test("a ci.yml with a changes job that writes the long release rule into any job instead of reading the changes output fails here", () => {
  for (const set of [CODE, SITE, { ...CODE, ci: { ...CODE.ci, tests: [...CODE.ci.tests, ...CODE.ci.tests.map((job) => ({ ...job, name: "e2e" }))] } }]) expect(ciText(set)).not.toContain("github.head_ref");
  expect(ciText(LIBRARY).split("github.head_ref").length - 1).toBe(3);
});

test("a skips input or an inline release rule with no comment above it to say what it decides fails here", () => {
  for (const set of [CODE, SITE, LIBRARY]) {
    const lines = ciText(set).split("\n");
    const unexplained = lines.filter((line, index) => /^\s+(?:skips|if): \$\{\{/.test(line) && !/^\s+# \S/.test(lines[index - 1] ?? ""));
    expect(unexplained).toEqual([]);
  }
});

test('a fork pull request from a release/ branch still runs every job instead of skipping as the release run', () => {
  const condition = conditionOf(ciJobs(LIBRARY)['static']);
  expect(decidesReleaseRun(condition, { eventName: 'pull_request', refName: 'release/main', headRef: 'release/main', baseRef: 'main', headRepo: 'fork/acme', repository: 'acme/acme' })).toBe(false);
  expect(decidesReleaseRun(condition, { eventName: 'pull_request', refName: 'release/main', headRef: 'release/main', baseRef: 'main', headRepo: 'acme/acme', repository: 'acme/acme' })).toBe(true);
  expect(decidesReleaseRun(condition, { eventName: 'PULL_REQUEST', refName: 'release/main', headRef: 'release/main', baseRef: 'main', headRepo: 'acme/acme', repository: 'acme/acme' })).toBe(true);
});

test('a release/ branch that does not match release/<base> still runs every job instead of skipping as the release run', () => {
  const condition = conditionOf(ciJobs(LIBRARY)['static']);
  expect(decidesReleaseRun(condition, { eventName: 'pull_request', refName: 'release/v2-prep', headRef: 'release/v2-prep', baseRef: 'main', headRepo: 'acme/acme', repository: 'acme/acme' })).toBe(false);
  expect(decidesReleaseRun(condition, { eventName: 'pull_request', refName: 'feature', headRef: 'feature', baseRef: 'main', headRepo: 'acme/acme', repository: 'acme/acme' })).toBe(false);
  expect(decidesReleaseRun(condition, { eventName: 'workflow_dispatch', refName: 'release/main', headRef: '', baseRef: 'main', headRepo: 'acme/acme', repository: 'acme/acme' })).toBe(true);
  expect(decidesReleaseRun(condition, { eventName: 'workflow_dispatch', refName: 'main', headRef: '', baseRef: 'main', headRepo: 'acme/acme', repository: 'acme/acme' })).toBe(false);
});

type Run = { readonly github: ReleaseContext; readonly release: boolean; readonly docsOnly: boolean };

const RELEASE_DISPATCH: Run = {
  github: { eventName: "workflow_dispatch", refName: "release/main", headRef: "", baseRef: "", headRepo: "", repository: "acme/acme" },
  release: true,
  docsOnly: false,
};
const FEATURE: ReleaseContext = { eventName: "pull_request", refName: "1/merge", headRef: "feature", baseRef: "main", headRepo: "acme/acme", repository: "acme/acme" };

function skippedAndPassed(set: CallerSet, run: Run): readonly (readonly string[])[] {
  const outputs = { release: String(run.release), "docs-only": String(run.docsOnly && !run.release) };
  const contexts = { github: githubOf(run.github), needs: { changes: { outputs } } };
  const jobs = Object.entries(ciJobs(set)).filter(([name]) => name !== "checks");
  const skipped: string[] = [];
  for (const [name, job] of jobs) {
    const needs = isRecord(job) ? job["needs"] : undefined;
    const condition = isRecord(job) ? job["if"] : undefined;
    if ((typeof needs === "string" && skipped.includes(needs)) || (typeof condition === "string" && !truthy(evaluated(condition, contexts)))) skipped.push(name);
  }
  const gate = ciJobs(set)["checks"];
  const inputs = isRecord(gate) ? gate["with"] : undefined;
  const skips = isRecord(inputs) && typeof inputs["skips"] === "string" ? evaluated(inputs["skips"], contexts).coerceString() : "no skips";
  return [skipped, skips.split(" ").filter((job) => job !== "")];
}

test("on the release run every job but changes skips and the gate passes exactly those skips, rather than the release pull request running the suite", () => {
  expect(skippedAndPassed(SITE, RELEASE_DISPATCH)).toEqual([["static", "site", "unit", "browser"], ["static", "site", "unit", "browser"]]);
  expect(skippedAndPassed(CODE, RELEASE_DISPATCH)).toEqual([["static", "test"], ["static", "test"]]);
  expect(skippedAndPassed(LIBRARY, RELEASE_DISPATCH)).toEqual([["static", "test"], ["static", "test"]]);
});

test("on a docs-only change the site and test jobs skip and the gate passes them, while static still runs and a library without changes runs all", () => {
  const docsOnly: Run = { github: FEATURE, release: false, docsOnly: true };
  expect(skippedAndPassed(SITE, docsOnly)).toEqual([["site", "unit", "browser"], ["site", "unit", "browser"]]);
  expect(skippedAndPassed(CODE, docsOnly)).toEqual([["test"], ["test"]]);
  expect(skippedAndPassed(LIBRARY, docsOnly)).toEqual([[], []]);
  const code: Run = { github: FEATURE, release: false, docsOnly: false };
  for (const set of [SITE, CODE, LIBRARY]) expect(skippedAndPassed(set, code)).toEqual([[], []]);
});

const heldCi = (text: string) => ({ path: ".github/workflows/ci.yml", document: Bun.YAML.parse(text), text });

const setOfCi = (text: string): CallerSet => Effect.runSync(callerSetOf([heldCi(text)], {}, "checks-workflows --write", false));

const faultOfCi = (text: string): string => Effect.runSync(Effect.flip(callerSetOf([heldCi(text)], {}, "checks-workflows --write", false))).message;

const HAND_EDITED = [
  "name: ci",
  "on: pull_request",
  "jobs:",
  "  static:",
  "    uses: avi2d/workflows/.github/workflows/static.yml@v3",
  "  unit:",
  "    uses: avi2d/workflows/.github/workflows/test.yml@main",
  "    with:",
  "      hold: true",
  "  e2e:",
  "    needs: unit",
  "    uses: avi2d/workflows/.github/workflows/test.yml@v3",
  "    with:",
  "      run: bun run test:e2e",
  "      browsers: chromium webkit",
  "      heavy: true",
  "      runs-on: macos-latest",
  "  lint:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - run: bun run lint",
  "  checks:",
  "    uses: avi2d/workflows/.github/workflows/gate.yml@v3",
  "",
].join("\n");

test("a write keeps the test jobs a composed ci.yml holds with their commands and drops a hand-added needs and a job that calls no part, so an e2e job is never lost", () => {
  const set = setOfCi(HAND_EDITED);
  const jobs = ciJobs(set);
  expect(Object.keys(jobs)).toEqual(["static", "unit", "e2e", "checks"]);
  expect(jobs["unit"]).toEqual({
    if: NOT_RELEASE,
    uses: PART("test.yml"),
    permissions: { contents: "read", actions: "write" },
    with: { "runs-on": "${{ vars.CI_RUNS_ON || 'ubuntu-latest' }}" },
  });
  expect(jobs["e2e"]).toEqual({
    if: NOT_RELEASE,
    uses: PART("test.yml"),
    permissions: { contents: "read", actions: "write" },
    with: { run: "bun run test:e2e", browsers: "chromium webkit", heavy: true, "runs-on": "macos-latest" },
  });
  expect(jobs["checks"]).toMatchObject({ needs: ["static", "unit", "e2e"], if: "always()", with: { results: "${{ toJSON(needs) }}" } });
  expect(jobs["checks"]).toMatchObject({ with: { skips: `\${{ ${RELEASE_RUN} && 'static unit e2e' || '' }}` } });
  const written = requiredSet(set).find(({ name }) => name === "ci.yml")?.text ?? "no ci.yml";
  expect(setOfCi(written)).toEqual(set);
});

test("a test job input that does not parse or a test job named like a fixed job is refused, so a write never drops the value silently", () => {
  expect(faultOfCi(HAND_EDITED.replace("      heavy: true", '      heavy: "yes"'))).toStartWith(".github/workflows/ci.yml job e2e passes a test.yml input that does not parse");
  expect(faultOfCi(HAND_EDITED.replace("  e2e:", "  site:").replace("    needs: unit\n", ""))).toBe(
    ".github/workflows/ci.yml calls test.yml from job site, a name the composed ci.yml cannot give a test job, so rename it",
  );
});

const SINGLE_JOB_CODE_CI = [
  "name: ci",
  "",
  "on:",
  "  pull_request:",
  "    types: [opened, synchronize, reopened, ready_for_review]",
  "  workflow_dispatch:",
  "",
  "concurrency:",
  "  group: ci-${{ github.event.pull_request.number || github.run_id }}",
  "  cancel-in-progress: true",
  "",
  "jobs:",
  "  checks:",
  "    uses: avi2d/workflows/.github/workflows/ci.yml@v3",
  "    permissions: { contents: read, actions: write, statuses: write, pull-requests: read }",
  "",
].join("\n");

const withCi = (set: CallerSet, text: string): readonly { name: string; text: string }[] =>
  requiredSet(set).map((file) => (file.name === "ci.yml" ? { name: "ci.yml", text } : file));

test("the single-job ci.yml the v3 kit wrote still passes until --write replaces it, and an edited one differs", () => {
  const present = withCi(CODE, SINGLE_JOB_CODE_CI);
  expect(differencesOf(CODE, present)).toEqual([]);
  expect(holdsSingleJobCi(CODE, present)).toBe(true);
  expect(holdsSingleJobCi(CODE, requiredSet(CODE))).toBe(false);
  const edited = SINGLE_JOB_CODE_CI.replace("cancel-in-progress: true", "cancel-in-progress: false");
  expect(differencesOf(CODE, withCi(CODE, edited)).map(({ kind, name }) => [kind, name])).toEqual([["differs", "ci.yml"]]);
  expect(differencesOf(SITE, withCi(SITE, SINGLE_JOB_CODE_CI)).map(({ kind, name }) => [kind, name])).toEqual([["differs", "ci.yml"]]);
});
