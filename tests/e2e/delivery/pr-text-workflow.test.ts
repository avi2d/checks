import { Evaluator, Lexer, Parser, data } from "@actions/expressions";
import { $ } from "bun";
import { expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withoutPullRequestEvent } from "../../lib/env.ts";
import { recordedCalls, stubBin } from "../lib/ci-command.ts";
import { CHECKOUT, fixtureRepos, ran, scratchDirs, withOwnInstall, type FixtureRepo, type Ran } from "../lib/fixture-repo.ts";
import { isRecord } from "../../../src/delivery/workflow-references.ts";

const open = fixtureRepos("checks-pr-text-workflow-");
const scratch = scratchDirs();
const SCRIPT = join(CHECKOUT, "src", "delivery", "workflows.ts");
const SCAN_MS = 120_000;
const NUMBER = "7";
const HEAD = "0123456789abcdef0123456789abcdef01234567";
const REPOSITORY = "acme/acme";
const PRIVATE = { "checks.config.ts": 'export default { repositoryVisibility: "private" };\n' };
const SKIPPED_SCAN = "scan skipped: no private pack is configured (CHECKS_SECRETS_PACK is unset)";

const manifest = JSON.stringify({ name: "acme", scripts: { lint: "oxlint", build: "tsc", typecheck: "tsc --noEmit", test: "bun test" } });

const workflows = (repo: FixtureRepo, args: readonly string[] = []): Promise<Ran> =>
  ran($`bun ${SCRIPT} ${args}`.cwd(repo.dir).env({ ...withoutPullRequestEvent(), GITHUB_REPOSITORY: REPOSITORY }));

const scanFile = (repo: FixtureRepo): string => join(repo.dir, ".github", "workflows", "pr-text.yml");

type Plain = string | { readonly [key: string]: Plain };

type Step = { readonly id: string | undefined; readonly if: string | undefined; readonly uses: string | undefined; readonly with: unknown; readonly run: string | undefined; readonly env: Readonly<Record<string, string>> };

type Job = { readonly if: string; readonly env: Readonly<Record<string, string>>; readonly steps: readonly Step[] };

const optionalString = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

const stringsOf = (value: unknown): Readonly<Record<string, string>> =>
  isRecord(value) ? Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, typeof inner === "string" ? inner : String(inner)])) : {};

const stepOf = (value: unknown): Step => {
  const step = isRecord(value) ? value : {};
  return { id: optionalString(step["id"]), if: optionalString(step["if"]), uses: optionalString(step["uses"]), with: step["with"], run: optionalString(step["run"]), env: stringsOf(step["env"]) };
};

const scanJobOf = (workflow: unknown): Job => {
  const jobs = isRecord(workflow) ? workflow["jobs"] : undefined;
  const job = isRecord(jobs) ? jobs["pr-text"] : undefined;
  if (!isRecord(job) || !Array.isArray(job["steps"])) throw new Error("expected pr-text.yml to hold a pr-text job with steps");
  return { if: optionalString(job["if"]) ?? "", env: stringsOf(job["env"]), steps: job["steps"].map(stepOf) };
};

const dictionaryOf = (record: { readonly [key: string]: Plain }): data.Dictionary =>
  new data.Dictionary(...Object.entries(record).map(([key, inner]) => ({ key, value: typeof inner === "string" ? new data.StringData(inner) : dictionaryOf(inner) })));

const statusFunction = (name: string, value: boolean) => ({ name, minArgs: 0, maxArgs: 0, call: (): data.ExpressionData => new data.BooleanData(value) });

const STATUS_FUNCTION = /\b(?:success|failure|cancelled|always)\(\)/;

const unwrapped = (expression: string): string => {
  const trimmed = expression.trim();
  return trimmed.startsWith("${{") && trimmed.endsWith("}}") ? trimmed.slice(3, -2).trim() : trimmed;
};

const evaluated = (expression: string, contexts: Readonly<Record<string, Plain>>, failed: boolean): data.ExpressionData => {
  const functions = new Map([
    ["always", statusFunction("always", true)],
    ["cancelled", statusFunction("cancelled", false)],
    ["failure", statusFunction("failure", failed)],
    ["success", statusFunction("success", !failed)],
  ]);
  const parser = new Parser(new Lexer(expression).lex().tokens, Object.keys(contexts), [...functions.values()]);
  return new Evaluator(parser.parse(), dictionaryOf(contexts), functions).evaluate();
};

const truthy = (result: data.ExpressionData): boolean => (result.kind === data.Kind.Boolean ? result.value : result.coerceString() !== "");

const runs = (condition: string | undefined, contexts: Readonly<Record<string, Plain>>, failed: boolean): boolean => {
  const inner = unwrapped(condition ?? "true");
  return truthy(evaluated(STATUS_FUNCTION.test(inner) ? inner : `success() && (${inner})`, contexts, failed));
};

const substituted = (text: string, contexts: Readonly<Record<string, Plain>>): string =>
  text.replace(/\$\{\{([\s\S]*?)\}\}/g, (_match: string, expression: string) => evaluated(expression, contexts, false).coerceString());

const keyValues = async (file: string): Promise<Readonly<Record<string, string>>> =>
  Object.fromEntries(
    (await readFile(file, "utf8").catch(() => ""))
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );

const pullRequestEvent = (eventName: string, headRepository = REPOSITORY): Plain => ({
  event_name: eventName,
  repository: REPOSITORY,
  token: "gh-token-value",
  event: { pull_request: { number: NUMBER, head: { repo: { full_name: headRepository } } }, repository: { default_branch: "main" } },
});

type Runner = { readonly dir: string; readonly bin: string; readonly record: string };

// Puts a gh on PATH that answers the scan's reads from files named after the endpoint and the status job's head read with HEAD.
async function stubbedGh(title: string, body: string): Promise<Runner> {
  const dir = await scratch("checks-pr-text-workflow-runner-");
  const answers: Readonly<Record<string, unknown>> = {
    [`repos/{owner}/{repo}/pulls/${NUMBER}`]: { title, body, state: "open" },
    [`repos/{owner}/{repo}/issues/${NUMBER}/comments`]: [[]],
    [`repos/{owner}/{repo}/pulls/${NUMBER}/reviews`]: [[]],
    [`repos/{owner}/{repo}/pulls/${NUMBER}/comments`]: [[]],
  };
  for (const [endpoint, answer] of Object.entries(answers)) await writeFile(join(dir, endpoint.replace(/[/{}]/g, "_")), JSON.stringify(answer));
  const bin = join(dir, "bin");
  stubBin(
    bin,
    "gh",
    `case "$*" in\n  *"--jq .head.sha"*) echo ${HEAD} ;;\n  *"/statuses/"*) ;;\n  *) for arg in "$@"; do endpoint=$arg; done\n     file="${dir}/$(printf '%s' "$endpoint" | tr '/{}' '___')"\n     [ -f "$file" ] || { echo "HTTP 404: Not Found" >&2; exit 1; }\n     cat "$file" ;;\nesac`,
  );
  return { dir, bin, record: join(dir, "calls") };
}

type Outcome = { readonly id: string; readonly outcome: "success" | "failure" | "skipped" };

const runStep = async (repo: FixtureRepo, runner: Runner, run: string, env: Readonly<Record<string, string>>): Promise<number> =>
  (
    await ran(
      $`bash --noprofile --norc -eo pipefail -c ${run}`.cwd(repo.dir).env({
        ...withoutPullRequestEvent(),
        ...env,
        PATH: `${runner.bin}:${process.env["PATH"] ?? ""}`,
        STUB_RECORD: runner.record,
        GITHUB_REPOSITORY: REPOSITORY,
        GITHUB_SHA: "fedcba9876543210fedcba9876543210fedcba98",
        GITHUB_SERVER_URL: "https://github.com",
        GITHUB_RUN_ID: "42",
        RUNNER_TEMP: runner.dir,
        GITHUB_ENV: join(runner.dir, "env"),
        GITHUB_OUTPUT: join(runner.dir, "output"),
        GITHUB_STEP_SUMMARY: join(runner.dir, "summary"),
      }),
    )
  ).exitCode;

// Runs every run step in order as a runner does, so checkout and setup are the only steps it leaves to the runner.
async function runJob(repo: FixtureRepo, job: Job, pack: string, runner: Runner): Promise<readonly Outcome[]> {
  const steps: Record<string, Plain> = {};
  const outcomes: Outcome[] = [];
  let failed = false;
  for (const [index, step] of job.steps.entries()) {
    const id = step.id ?? `step-${index}`;
    const contexts = { github: pullRequestEvent("pull_request_target"), secrets: { CHECKS_SECRETS_PACK: pack }, steps };
    if (step.run === undefined || !runs(step.if, contexts, failed)) {
      outcomes.push({ id, outcome: step.run === undefined ? "success" : "skipped" });
      steps[id] = { outputs: {}, outcome: step.run === undefined ? "success" : "skipped" };
      continue;
    }
    await writeFile(join(runner.dir, "output"), "");
    const env = Object.fromEntries(Object.entries({ ...job.env, ...step.env }).map(([key, value]) => [key, substituted(value, contexts)]));
    const exitCode = await runStep(repo, runner, step.run, { ...(await keyValues(join(runner.dir, "env"))), ...env });
    const outcome = exitCode === 0 ? "success" : "failure";
    failed ||= exitCode !== 0;
    outcomes.push({ id, outcome });
    steps[id] = { outputs: { ...(await keyValues(join(runner.dir, "output"))) }, outcome };
  }
  return outcomes;
}

const statusCall = (state: string, description: string): readonly string[] => [
  "api",
  `repos/${REPOSITORY}/statuses/${HEAD}`,
  "-f",
  `state=${state}`,
  "-f",
  "context=pr-text",
  "-f",
  `description=${description}`,
  "-f",
  `target_url=https://github.com/${REPOSITORY}/actions/runs/42`,
  "--silent",
];

const statusCalls = (runner: Runner): readonly unknown[] => recordedCalls(runner.record).filter((call) => Array.isArray(call) && String(call[1]).includes("/statuses/"));

const scanReads = (runner: Runner): readonly unknown[] => recordedCalls(runner.record).filter((call) => Array.isArray(call) && String(call.at(-1)).startsWith("repos/{owner}/{repo}/"));

const fake = (prefix: string): string => `${prefix}${randomBytes(4).toString("hex")}`;

async function writtenScan(): Promise<{ readonly repo: FixtureRepo; readonly job: Job }> {
  const repo = await open({ "package.json": manifest });
  await repo.commit("start");
  expect((await workflows(repo, ["--write"])).exitCode).toBe(0);
  await withOwnInstall(repo);
  return { repo, job: scanJobOf(Bun.YAML.parse(await readFile(scanFile(repo), "utf8"))) };
}

test("a public repository's written pr-text.yml leaves no step that runs pull request code, skips a fork's review instead of failing it, and does not skip a comment on a pull request", async () => {
  const { repo, job } = await writtenScan();
  expect(Bun.YAML.parse(await readFile(scanFile(repo), "utf8"))).toMatchObject({
    on: {
      pull_request_target: { types: ["opened", "edited", "synchronize", "reopened"] },
      issue_comment: { types: ["created", "edited", "deleted"] },
      pull_request_review: { types: ["submitted", "edited"] },
      pull_request_review_comment: { types: ["created", "edited", "deleted"] },
    },
  });
  expect(job.steps.flatMap((step) => (step.uses === undefined ? [] : [[step.uses.replace(/@.*/, ""), step.with]]))).toEqual([
    ["actions/checkout", { ref: "${{ github.event.repository.default_branch }}", "persist-credentials": false }],
    ["./.github/actions/setup", undefined],
  ]);
  expect(job.steps.map((step) => step.run).filter((run) => run !== undefined)).toEqual(["bunx checks-ci secrets-pack", 'bunx checks-pr-text "$NUMBER"', "bunx checks-ci commit-status"]);
  expect(runs(job.if, { github: pullRequestEvent("pull_request_target", "fork/acme") }, false)).toBe(true);
  expect(runs(job.if, { github: pullRequestEvent("pull_request_review", REPOSITORY) }, false)).toBe(true);
  expect(runs(job.if, { github: pullRequestEvent("pull_request_review", "fork/acme") }, false)).toBe(false);
  expect(runs(job.if, { github: { event_name: "issue_comment", event: { issue: { number: NUMBER, pull_request: { url: "https://api.github.com/repos/acme/acme/pulls/7" } } } } }, false)).toBe(true);
  expect(runs(job.if, { github: { event_name: "issue_comment", event: { issue: { number: NUMBER } } } }, false)).toBe(false);
}, 30_000);

test(
  "the written pr-text.yml run as a runner runs it posts a failed status for a pack term in the body and a passed one for clean text, instead of passing both",
  async () => {
    const { repo, job } = await writtenScan();
    const name = `${fake("Fakefirst")} ${fake("Fakelast")}`;
    const pack = JSON.stringify({ names: [name] });

    const leaked = await stubbedGh("fix: tidy", `thanks ${name}\n`);
    expect(await runJob(repo, job, pack, leaked)).toEqual([
      { id: "step-0", outcome: "success" },
      { id: "step-1", outcome: "success" },
      { id: "pack", outcome: "success" },
      { id: "scan", outcome: "failure" },
      { id: "step-4", outcome: "success" },
    ]);
    expect(statusCalls(leaked)).toEqual([statusCall("failure", "the scan failed or did not run")]);

    const clean = await stubbedGh("fix: tidy", "nothing private here\n");
    expect((await runJob(repo, job, pack, clean)).find(({ id }) => id === "scan")).toEqual({ id: "scan", outcome: "success" });
    expect(statusCalls(clean)).toEqual([statusCall("success", "the scan passed")]);
  },
  SCAN_MS,
);

test(
  "the written pr-text.yml run without a pack skips the scan and posts a passed status that says so, instead of failing every pull request",
  async () => {
    const { repo, job } = await writtenScan();
    const runner = await stubbedGh("fix: tidy", "body\n");
    expect((await runJob(repo, job, "", runner)).find(({ id }) => id === "scan")).toEqual({ id: "scan", outcome: "skipped" });
    expect(scanReads(runner)).toEqual([]);
    expect(statusCalls(runner)).toEqual([statusCall("success", SKIPPED_SCAN)]);
  },
  SCAN_MS,
);

test("a public repository's edited pr-text.yml is refused and --write restores it, while a private repository gets none written", async () => {
  const { repo } = await writtenScan();
  const written = await readFile(scanFile(repo), "utf8");
  await writeFile(scanFile(repo), written.replace("cancel-in-progress: true", "cancel-in-progress: false"));
  const refused = await workflows(repo);
  expect(refused.exitCode).toBe(1);
  expect(refused.text).toContain("  .github/workflows/pr-text.yml: differs from the file checks-workflows writes\n");
  expect((await workflows(repo, ["--write"])).exitCode).toBe(0);
  expect(await readFile(scanFile(repo), "utf8")).toBe(written);

  const closed = await open({ "package.json": manifest, ...PRIVATE });
  await closed.commit("start");
  expect((await workflows(closed, ["--write"])).exitCode).toBe(0);
  expect(await Bun.file(scanFile(closed)).exists()).toBe(false);
}, 30_000);

test("a public repository's pr-text.yml that calls another repository's workflow is replaced by --write rather than kept by hand", async () => {
  const caller = "name: pr-text\non: pull_request_target\njobs:\n  text:\n    uses: avi2d/workflows/.github/workflows/pr-text.yml@v3\n    permissions: { contents: read }\n";
  const repo = await open({ "package.json": manifest, ".github/workflows/pr-text.yml": caller });
  await repo.commit("start");
  const refused = await workflows(repo);
  expect(refused.text).toContain("  run checks-workflows --write to write the set\n");
  expect(refused.text).not.toContain("never writes");
  expect((await workflows(repo, ["--write"])).exitCode).toBe(0);
  expect(scanJobOf(Bun.YAML.parse(await readFile(scanFile(repo), "utf8"))).steps.some((step) => step.run === 'bunx checks-pr-text "$NUMBER"')).toBe(true);
  expect(await workflows(repo)).toEqual({ exitCode: 0, text: "workflows: .github/workflows holds the code set checks-workflows writes\n" });
}, 30_000);

test("a private repository's pr-text.yml scan stays as it is: it is no extra, --write keeps it, and it is never compared", async () => {
  const scan = "name: pr-text\non:\n  pull_request_target:\n    types: [opened]\n";
  const repo = await open({ "package.json": manifest, ...PRIVATE, ".github/workflows/pr-text.yml": scan });
  await repo.commit("start");

  const refused = await workflows(repo);
  expect(refused.exitCode).toBe(1);
  expect(refused.text).toContain("  .github/workflows/ci.yml: missing\n");
  expect(refused.text).not.toContain("pr-text");
  expect(await workflows(repo, ["--write"])).toEqual({ exitCode: 0, text: "workflows: wrote the 6 workflow file(s) of the code set and its 2 action file(s)\n" });
  expect(await readFile(scanFile(repo), "utf8")).toBe(scan);
  expect((await workflows(repo)).exitCode).toBe(0);
}, 30_000);

test("a private repository's pr-text.yml job that calls avi2d/workflows is refused instead of passing uncompared", async () => {
  const caller = "name: pr-text\non: pull_request_target\njobs:\n  text:\n    uses: avi2d/workflows/.github/workflows/pr-text.yml@v3\n    permissions: { contents: read }\n";
  const repo = await open({ "package.json": manifest, ...PRIVATE, ".github/workflows/pr-text.yml": caller });
  await repo.commit("start");
  await workflows(repo, ["--write"]);

  const refused = await workflows(repo);
  expect(refused).toEqual({
    exitCode: 1,
    text: [
      "workflows: .github/workflows holds the code set checks-workflows writes",
      "workflows: 1 job(s) call a workflow of another repository:",
      "  .github/workflows/pr-text.yml job text: calls avi2d/workflows/.github/workflows/pr-text.yml@v3, a workflow of another repository, where the set holds every step itself",
      "  checks-workflows --write never writes .github/workflows/pr-text.yml, so replace its calling jobs with their own steps by hand",
      "",
    ].join("\n"),
  });
}, 30_000);
