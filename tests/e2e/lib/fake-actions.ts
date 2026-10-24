#!/usr/bin/env bun
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Schema } from "effect";

const Artifact = Schema.Struct({
  id: Schema.Int,
  name: Schema.String,
  expired: Schema.Boolean,
  files: Schema.Record(Schema.String, Schema.String),
});

const Run = Schema.Struct({
  databaseId: Schema.Int,
  event: Schema.String,
  createdAt: Schema.String,
  headSha: Schema.optionalKey(Schema.String),
  artifacts: Schema.Array(Artifact),
});

const Issue = Schema.Struct({
  number: Schema.Int,
  title: Schema.String,
  body: Schema.String,
  labels: Schema.Array(Schema.String),
  comments: Schema.Array(Schema.String),
});

const State = Schema.Struct({
  repositoryId: Schema.Int,
  workflow: Schema.String,
  issues: Schema.Array(Issue),
  labels: Schema.Array(Schema.String),
  runs: Schema.Array(Run),
  downloadsMeet: Schema.Int,
  inProgress: Schema.Array(Schema.Int),
  failing: Schema.Array(Schema.String),
  calls: Schema.Array(Schema.String),
});

export type FakeRun = typeof Run.Type;
type FakeIssue = typeof Issue.Type;
type FakeState = typeof State.Type;

const decodeState = Schema.decodeUnknownSync(Schema.fromJsonString(State));
const decodeNewIssue = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ title: Schema.String, body: Schema.String, labels: Schema.Array(Schema.String) })));
const decodeComment = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ body: Schema.String })));

export type FakeActions = {
  readonly env: Readonly<Record<string, string>>;
  readonly downloads: () => Promise<readonly string[]>;
  readonly calls: () => Promise<readonly string[]>;
  readonly issues: () => Promise<readonly FakeIssue[]>;
  readonly labels: () => Promise<readonly string[]>;
};

// `downloadsMeet` holds each download until that many have started, so jobs sharing a runner miss its cache together.
// `inProgress` names the runs a successful run list leaves out, and a call starting with an entry of `failing` fails with HTTP 502.
export type FakeOptions = {
  readonly downloadsMeet?: number;
  readonly inProgress?: readonly number[];
  readonly failing?: readonly string[];
  readonly workflow?: string;
  readonly issues?: readonly FakeIssue[];
};

// Puts a `gh` on PATH that answers the run list, artifact and download calls from successful runs of a workflow on main, mutation.yml unless named, and the issue and label calls.
export async function fakeActions(home: string, repositoryId: number, runs: readonly FakeRun[], options: FakeOptions = {}): Promise<FakeActions> {
  const bin = join(home, "bin");
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, "gh"), `#!/bin/sh\nexec bun ${import.meta.path} "$@"\n`, { mode: 0o755 });
  const statePath = join(home, "actions.json");
  const initial = {
    repositoryId,
    workflow: options.workflow ?? "mutation.yml",
    issues: options.issues ?? [],
    labels: [],
    runs,
    downloadsMeet: options.downloadsMeet ?? 0,
    inProgress: options.inProgress ?? [],
    failing: options.failing ?? [],
    calls: [],
  } satisfies FakeState;
  await writeFile(statePath, JSON.stringify(initial));
  const state = async () => decodeState(await readFile(statePath, "utf8"));
  const calls = async () => (await state()).calls;
  return {
    issues: async () => (await state()).issues,
    labels: async () => (await state()).labels,
    env: { PATH: `${bin}:${process.env["PATH"] ?? ""}`, FAKE_ACTIONS_STATE: statePath },
    downloads: async () => (await calls()).filter((call) => call.startsWith("run download")),
    calls,
  };
}

function flag(args: readonly string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}

function listRuns(state: FakeState, args: readonly string[]): string | undefined {
  if (flag(args, "--workflow") !== state.workflow || flag(args, "--branch") !== "main" || flag(args, "--status") !== "success") return undefined;
  if (flag(args, "--json") !== "databaseId,event,createdAt") return undefined;
  const event = flag(args, "--event");
  const listed = [...state.runs]
    .filter((run) => !state.inProgress.includes(run.databaseId) && (event === undefined || run.event === event))
    .sort((one, other) => other.createdAt.localeCompare(one.createdAt))
    .slice(0, Number(flag(args, "--limit") ?? "20"))
    .map(({ databaseId, event: runEvent, createdAt }) => ({ databaseId, event: runEvent, createdAt }));
  return JSON.stringify(listed);
}

function listArtifacts(state: FakeState, endpoint: string): string | undefined {
  const matched = /^repos\/\{owner\}\/\{repo\}\/actions\/runs\/(\d+)\/artifacts\?name=(.+)$/.exec(endpoint);
  const run = state.runs.find((one) => String(one.databaseId) === matched?.[1]);
  if (matched === null || run === undefined) return undefined;
  const artifacts = run.artifacts
    .filter((artifact) => artifact.name === matched[2])
    .map(({ id, name, expired }) => ({ id, name, expired, workflow_run: { id: run.databaseId, repository_id: state.repositoryId } }));
  return JSON.stringify({ total_count: artifacts.length, artifacts });
}

async function meet(state: FakeState, statePath: string): Promise<void> {
  const arrivals = join(dirname(statePath), "downloads-started");
  await mkdir(arrivals, { recursive: true });
  await writeFile(join(arrivals, String(process.pid)), "");
  while ((await readdir(arrivals)).length < state.downloadsMeet) await Bun.sleep(20);
}

async function viewRun(state: FakeState, args: readonly string[]): Promise<string | undefined> {
  const run = state.runs.find((one) => String(one.databaseId) === args[0]);
  return run === undefined ? undefined : JSON.stringify({ headSha: run.headSha ?? "" });
}

async function download(state: FakeState, args: readonly string[]): Promise<boolean> {
  const [runId = ""] = args;
  const name = flag(args, "--name");
  const dir = flag(args, "--dir") ?? ".";
  const artifact = state.runs.find((run) => String(run.databaseId) === runId)?.artifacts.find((one) => one.name === name && !one.expired);
  if (artifact === undefined) return false;
  for (const [path, content] of Object.entries(artifact.files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), content);
  }
  return true;
}

function listRepoArtifacts(state: FakeState, endpoint: string): string | undefined {
  const matched = /^repos\/\{owner\}\/\{repo\}\/actions\/artifacts(\?(.*))?$/.exec(endpoint);
  if (matched === null) return undefined;
  const params = new URLSearchParams(matched[2] ?? "");
  const perPage = Number(params.get("per_page") ?? "30");
  const page = Number(params.get("page") ?? "1");
  const all = state.runs.flatMap((run) =>
    run.artifacts.map(({ id, name, expired }) => ({ id, name, expired, workflow_run: { id: run.databaseId, repository_id: state.repositoryId } })),
  );
  return JSON.stringify({ total_count: all.length, artifacts: all.slice((page - 1) * perPage, page * perPage) });
}

function erase(state: FakeState, endpoint: string): FakeState | undefined {
  const matched = /^repos\/\{owner\}\/\{repo\}\/actions\/artifacts\/(\d+)$/.exec(endpoint);
  if (matched === null) return undefined;
  const id = Number(matched[1]);
  if (!state.runs.some((run) => run.artifacts.some((artifact) => artifact.id === id))) return undefined;
  return { ...state, runs: state.runs.map((run) => ({ ...run, artifacts: run.artifacts.filter((artifact) => artifact.id !== id) })) };
}

type Answer = { readonly state: FakeState; readonly out: string };

const ISSUES = "repos/{owner}/{repo}/issues";

function issueCall(state: FakeState, method: string, endpoint: string, input: string): Answer | undefined {
  const [path, query = ""] = endpoint.split("?");
  if (method === "GET" && path === ISSUES) {
    const label = new URLSearchParams(query).get("labels");
    const listed = state.issues.filter((issue) => label === null || issue.labels.includes(label)).map(({ number, title, body }) => ({ number, title, body }));
    return { state, out: JSON.stringify(listed) };
  }
  if (method === "POST" && path === ISSUES) {
    const issue = { number: 100 + state.issues.length, ...decodeNewIssue(input), comments: [] };
    return { state: { ...state, issues: [...state.issues, issue] }, out: JSON.stringify({ number: issue.number }) };
  }
  const commented = Number(/^repos\/\{owner\}\/\{repo\}\/issues\/(\d+)\/comments$/.exec(path ?? "")?.[1]);
  if (method !== "POST" || !state.issues.some((issue) => issue.number === commented)) return undefined;
  const { body } = decodeComment(input);
  const issues = state.issues.map((issue) => (issue.number === commented ? { ...issue, comments: [...issue.comments, body] } : issue));
  return { state: { ...state, issues }, out: JSON.stringify({ id: 1 }) };
}

// `gh label create --force` creates the label or updates the one already there.
function labelCall(state: FakeState, args: readonly string[]): Answer | undefined {
  const [command, subcommand, name] = args;
  if (command !== "label" || subcommand !== "create" || name === undefined || !args.includes("--force")) return undefined;
  return { state: { ...state, labels: [...new Set([...state.labels, name])] }, out: "" };
}

async function changed(state: FakeState, args: readonly string[]): Promise<Answer | undefined> {
  const method = flag(args, "--method");
  const endpoint = args.find((arg) => arg.startsWith("repos/"));
  if (args[0] === "api" && method !== undefined && endpoint !== undefined) {
    return issueCall(state, method, endpoint, args.includes("--input") ? await Bun.stdin.text() : "");
  }
  return labelCall(state, args);
}

async function answer(state: FakeState, args: readonly string[]): Promise<string | undefined> {
  const [command, subcommand, ...rest] = args;
  if (command === "run" && subcommand === "list") return listRuns(state, rest);
  if (command === "run" && subcommand === "view") return viewRun(state, rest);
  if (command === "api" && subcommand !== undefined) return listArtifacts(state, subcommand) ?? listRepoArtifacts(state, subcommand);
  if (command === "run" && subcommand === "download") return (await download(state, rest)) ? "" : undefined;
  return undefined;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const statePath = process.env["FAKE_ACTIONS_STATE"] ?? "";
  const recorded = decodeState(await readFile(statePath, "utf8"));
  if (recorded.failing.some((prefix) => args.join(" ").startsWith(prefix))) {
    process.stderr.write("gh: HTTP 502\n");
    return 1;
  }
  if ((flag(args, "-X") ?? flag(args, "--method")) === "DELETE") {
    const target = args.find((arg) => arg.startsWith("repos/"));
    const erased = target === undefined ? undefined : erase(recorded, target);
    if (erased === undefined) {
      process.stderr.write(`fake gh: no answer for ${args.join(" ")}\n`);
      return 1;
    }
    await writeFile(statePath, JSON.stringify({ ...erased, calls: [...erased.calls, args.join(" ")] }));
    return 0;
  }
  await writeFile(statePath, JSON.stringify({ ...recorded, calls: [...recorded.calls, args.join(" ")] }));
  if (args[0] === "run" && args[1] === "download") await meet(recorded, statePath);
  const logged = { ...recorded, calls: [...recorded.calls, args.join(" ")] };
  const change = await changed(logged, args);
  if (change !== undefined) {
    await writeFile(statePath, JSON.stringify(change.state));
    process.stdout.write(change.out);
    return 0;
  }
  const out = await answer(recorded, args);
  if (out === undefined) {
    process.stderr.write(`fake gh: no answer for ${args.join(" ")}\n`);
    return 1;
  }
  process.stdout.write(out);
  return 0;
}

if (import.meta.main) process.exitCode = await main();
