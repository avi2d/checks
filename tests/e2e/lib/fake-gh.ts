#!/usr/bin/env bun
import { $ } from "bun";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Schema } from "effect";

const Pull = Schema.Struct({
  number: Schema.Int,
  title: Schema.String,
  head: Schema.String,
  base: Schema.String,
  body: Schema.String,
  html_url: Schema.String,
});

const Run = Schema.Struct({
  path: Schema.String,
  head_sha: Schema.String,
  status: Schema.String,
  conclusion: Schema.NullOr(Schema.String),
  html_url: Schema.String,
});

const State = Schema.Struct({
  calls: Schema.Array(Schema.String),
  pulls: Schema.Array(Pull),
  dispatches: Schema.Array(Schema.Struct({ workflow: Schema.String, ref: Schema.String })),
  runs: Schema.Array(Run),
});

type FakeState = typeof State.Type;

const Body = Schema.Record(Schema.String, Schema.Unknown);
type Body = typeof Body.Type;

const Entries = Schema.Array(Schema.Struct({ path: Schema.String, mode: Schema.String, sha: Schema.NullOr(Schema.String) }));
const Strings = Schema.Array(Schema.String);

const decodeState = Schema.decodeUnknownSync(Schema.fromJsonString(State));
const decodeBody = Schema.decodeUnknownSync(Schema.fromJsonString(Body));
const decodeEntries = Schema.decodeUnknownSync(Entries);
const decodeStrings = Schema.decodeUnknownSync(Strings);
const decodeString = Schema.decodeUnknownSync(Schema.String);

type Answer = { readonly state: FakeState; readonly body: unknown };

export type FakeGh = {
  readonly env: Readonly<Record<string, string>>;
  readonly state: () => Promise<FakeState>;
};

const REPOSITORY = "repos/{owner}/{repo}/";
const ACTIONS_BOT = {
  GIT_AUTHOR_NAME: "github-actions[bot]",
  GIT_AUTHOR_EMAIL: "41898282+github-actions[bot]@users.noreply.github.com",
  GIT_COMMITTER_NAME: "GitHub",
  GIT_COMMITTER_EMAIL: "noreply@github.com",
};

// Puts a `gh` on PATH that answers `gh api` from a bare repository, so a test reads the refs and objects a bin made through the API.
export async function fakeGh(home: string, origin: string): Promise<FakeGh> {
  await writeFile(join(home, "gh"), `#!/bin/sh\nexec bun ${import.meta.path} "$@"\n`, { mode: 0o755 });
  const statePath = join(home, "state.json");
  await writeFile(statePath, JSON.stringify({ calls: [], pulls: [], dispatches: [], runs: [] } satisfies FakeState));
  return {
    env: { PATH: `${home}:${process.env["PATH"] ?? ""}`, FAKE_GH_STATE: statePath, FAKE_GH_ORIGIN: origin },
    state: async () => decodeState(await readFile(statePath, "utf8")),
  };
}

async function buildTree(origin: string, body: Body): Promise<string> {
  const scratch = await mkdtemp(join(tmpdir(), "fake-gh-index-"));
  const env = { ...process.env, GIT_INDEX_FILE: join(scratch, "index") };
  try {
    await $`git read-tree ${decodeString(body["base_tree"])}`.cwd(origin).env(env).quiet();
    for (const { path, mode, sha } of decodeEntries(body["tree"])) {
      await (sha === null
        ? $`git update-index --force-remove -- ${path}`.cwd(origin).env(env).quiet()
        : $`git update-index --add --cacheinfo ${mode},${sha},${path}`.cwd(origin).env(env).quiet());
    }
    return (await $`git write-tree`.cwd(origin).env(env).quiet()).stdout.toString().trim();
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

async function gitApi(origin: string, method: string, route: string, body: Body): Promise<unknown> {
  if (method === "POST" && route === "git/blobs") {
    const bytes = Buffer.from(decodeString(body["content"]), "base64");
    return { sha: (await $`git hash-object -w --stdin < ${bytes}`.cwd(origin).quiet()).stdout.toString().trim() };
  }
  if (method === "POST" && route === "git/trees") return { sha: await buildTree(origin, body) };
  if (method === "POST" && route === "git/commits") {
    const parents = decodeStrings(body["parents"]).flatMap((parent) => ["-p", parent]);
    const made = await $`git commit-tree ${decodeString(body["tree"])} ${parents} -m ${decodeString(body["message"])}`
      .cwd(origin)
      .env({ ...process.env, ...ACTIONS_BOT })
      .quiet();
    return { sha: made.stdout.toString().trim() };
  }
  if (method === "POST" && route === "git/refs") {
    const ref = decodeString(body["ref"]);
    await $`git update-ref ${ref} ${decodeString(body["sha"])} ${""}`.cwd(origin).quiet();
    return { ref };
  }
  if (method === "PATCH" && route.startsWith("git/refs/")) {
    const ref = route.slice("git/".length);
    await $`git update-ref ${ref} ${decodeString(body["sha"])}`.cwd(origin).quiet();
    return { ref };
  }
  return undefined;
}

function listPulls(state: FakeState, query: string): Answer {
  const wanted = new URLSearchParams(query);
  const head = (wanted.get("head") ?? "").replace(/^\{owner\}:/, "");
  return { state, body: state.pulls.filter((pull) => pull.head === head && pull.base === wanted.get("base")) };
}

function openPull(state: FakeState, body: Body): Answer {
  const number = state.pulls.length + 1;
  const pull = {
    number,
    title: decodeString(body["title"]),
    head: decodeString(body["head"]),
    base: decodeString(body["base"]),
    body: decodeString(body["body"]),
    html_url: `https://github.com/acme/widget/pull/${number}`,
  };
  return { state: { ...state, pulls: [...state.pulls, pull] }, body: pull };
}

function editPull(state: FakeState, number: string, body: Body): Answer | undefined {
  const pull = state.pulls.find((one) => String(one.number) === number);
  if (pull === undefined) return undefined;
  const edited = { ...pull, title: decodeString(body["title"]), body: decodeString(body["body"]) };
  return { state: { ...state, pulls: state.pulls.map((one) => (one === pull ? edited : one)) }, body: edited };
}

// A dispatched run finishes at once with FAKE_GH_CONCLUSION, or FAKE_GH_CONCLUSION_<WORKFLOW> for one workflow, and GitHub lists the newest run first.
function conclusionOf(workflow: string): string {
  const key = `FAKE_GH_CONCLUSION_${workflow.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
  return process.env[key] ?? process.env["FAKE_GH_CONCLUSION"] ?? "success";
}

async function dispatchRun(origin: string, state: FakeState, workflow: string, body: Body): Promise<Answer> {
  const ref = decodeString(body["ref"]);
  const headSha = (await $`git rev-parse ${ref}^{commit}`.cwd(origin).quiet()).stdout.toString().trim();
  const run = {
    path: `.github/workflows/${workflow}`,
    head_sha: headSha,
    status: "completed",
    conclusion: conclusionOf(workflow),
    html_url: `https://github.com/acme/widget/actions/runs/${state.runs.length + 1}`,
  };
  return { state: { ...state, dispatches: [...state.dispatches, { workflow, ref }], runs: [run, ...state.runs] }, body: undefined };
}

async function pullsApi(origin: string, state: FakeState, method: string, route: string, body: Body): Promise<Answer | undefined> {
  const [path = "", query = ""] = route.split("?");
  if (method === "GET" && path === "pulls") return listPulls(state, query);
  if (method === "POST" && path === "pulls") return openPull(state, body);
  const edited = /^pulls\/(\d+)$/.exec(path)?.[1];
  if (method === "PATCH" && edited !== undefined) return editPull(state, edited, body);
  const workflow = /^actions\/workflows\/([^/]+)\/dispatches$/.exec(path)?.[1];
  if (method === "POST" && workflow !== undefined) return dispatchRun(origin, state, workflow, body);
  if (method === "GET" && path === "actions/permissions/workflow") {
    return {
      state,
      body: { default_workflow_permissions: "read", can_approve_pull_request_reviews: process.env["FAKE_GH_APPROVE"] !== "0" },
    };
  }
  if (method === "GET" && path === "actions/runs") {
    const headSha = new URLSearchParams(query).get("head_sha");
    return { state, body: { workflow_runs: state.runs.filter((run) => run.head_sha === headSha) } };
  }
  return undefined;
}

// GitHub refuses an unforced ref update that would drop commits the ref holds.
async function isForcedOver(origin: string, method: string, route: string, body: Body): Promise<boolean> {
  if (method !== "PATCH" || !route.startsWith("git/refs/") || body["force"] !== false) return false;
  const ref = route.slice("git/".length);
  const ancestor = await $`git merge-base --is-ancestor ${ref} ${decodeString(body["sha"])}`.cwd(origin).nothrow().quiet();
  return ancestor.exitCode !== 0;
}

function refuse(message: string): number {
  process.stderr.write(`${message}\n`);
  return 1;
}

async function main(): Promise<number> {
  const [command, , method = "", endpoint = "", ...rest] = process.argv.slice(2);
  const statePath = process.env["FAKE_GH_STATE"] ?? "";
  const origin = process.env["FAKE_GH_ORIGIN"] ?? "";
  const recorded = decodeState(await readFile(statePath, "utf8"));
  const state = { ...recorded, calls: [...recorded.calls, `${method} ${endpoint}`] };
  await writeFile(statePath, JSON.stringify(state));
  if (command !== "api" || !endpoint.startsWith(REPOSITORY)) return refuse(`fake gh: unknown call ${process.argv.slice(2).join(" ")}`);
  if (process.env["FAKE_GH_FAIL"] === `${method} ${endpoint}`) return refuse("gh: Resource not accessible by integration (HTTP 403)");
  const failRunsTimes = Number(process.env["FAKE_GH_FAIL_RUNS_TIMES"] ?? "0");
  if (method === "GET" && endpoint.startsWith(`${REPOSITORY}actions/runs`) && state.calls.filter((call) => call.startsWith("GET repos/{owner}/{repo}/actions/runs")).length <= failRunsTimes)
    return refuse("gh: HTTP 502: Bad Gateway");
  const body = rest.includes("--input") ? decodeBody(await Bun.stdin.text()) : {};
  const route = endpoint.slice(REPOSITORY.length);
  if (await isForcedOver(origin, method, route, body)) return refuse("gh: Update is not a fast forward (HTTP 422)");
  const fromGit = await gitApi(origin, method, route, body);
  const answer = fromGit === undefined ? await pullsApi(origin, state, method, route, body) : { state, body: fromGit };
  if (answer === undefined) return refuse(`fake gh: no route for ${method} ${endpoint}`);
  await writeFile(statePath, JSON.stringify(answer.state));
  if (process.env["FAKE_GH_LOSE_REPLY"] === `${method} ${endpoint}`) {
    const race = process.env["FAKE_GH_RACE_COMMIT"] ?? "";
    if (race !== "" && method === "PATCH" && route.startsWith("git/refs/")) {
      const sha = decodeString(body["sha"]);
      const tree = (await $`git rev-parse ${sha}^{tree}`.cwd(origin).quiet()).stdout.toString().trim();
      const child = (
        await $`git commit-tree ${tree} -p ${sha} -m ${race}`.cwd(origin).env({ ...process.env, ...ACTIONS_BOT }).quiet()
      ).stdout.toString().trim();
      await $`git update-ref ${route.slice("git/".length)} ${child}`.cwd(origin).quiet();
    }
    return refuse("gh: HTTP 502: Bad Gateway");
  }
  if (answer.body !== undefined) process.stdout.write(JSON.stringify(answer.body));
  return 0;
}

if (import.meta.main) process.exitCode = await main();
