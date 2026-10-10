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
  artifacts: Schema.Array(Artifact),
});

const State = Schema.Struct({
  repositoryId: Schema.Int,
  runs: Schema.Array(Run),
  listFails: Schema.Boolean,
  downloadsMeet: Schema.Int,
  calls: Schema.Array(Schema.String),
});

export type FakeRun = typeof Run.Type;
type FakeState = typeof State.Type;

const decodeState = Schema.decodeUnknownSync(Schema.fromJsonString(State));

export type FakeActions = {
  readonly env: Readonly<Record<string, string>>;
  readonly downloads: () => Promise<readonly string[]>;
};

// `downloadsMeet` holds each download until that many have started, so jobs sharing a runner miss its cache together.
export type FakeOptions = { readonly listFails?: boolean; readonly downloadsMeet?: number };

// Puts a `gh` on PATH that answers the run list, artifact and download calls from successful runs of mutation.yml on main.
export async function fakeActions(home: string, repositoryId: number, runs: readonly FakeRun[], options: FakeOptions = {}): Promise<FakeActions> {
  const bin = join(home, "bin");
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, "gh"), `#!/bin/sh\nexec bun ${import.meta.path} "$@"\n`, { mode: 0o755 });
  const statePath = join(home, "actions.json");
  await writeFile(statePath, JSON.stringify({ repositoryId, runs, listFails: options.listFails ?? false, downloadsMeet: options.downloadsMeet ?? 0, calls: [] } satisfies FakeState));
  return {
    env: { PATH: `${bin}:${process.env["PATH"] ?? ""}`, FAKE_ACTIONS_STATE: statePath },
    downloads: async () => decodeState(await readFile(statePath, "utf8")).calls.filter((call) => call.startsWith("run download")),
  };
}

function flag(args: readonly string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}

function listRuns(state: FakeState, args: readonly string[]): string | undefined {
  if (flag(args, "--workflow") !== "mutation.yml" || flag(args, "--branch") !== "main" || flag(args, "--status") !== "success") return undefined;
  if (flag(args, "--json") !== "databaseId,event,createdAt") return undefined;
  const event = flag(args, "--event");
  const listed = [...state.runs]
    .filter((run) => event === undefined || run.event === event)
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

async function answer(state: FakeState, args: readonly string[]): Promise<string | undefined> {
  const [command, subcommand, ...rest] = args;
  if (command === "run" && subcommand === "list") return listRuns(state, rest);
  if (command === "api" && subcommand !== undefined) return listArtifacts(state, subcommand);
  if (command === "run" && subcommand === "download") return (await download(state, rest)) ? "" : undefined;
  return undefined;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const statePath = process.env["FAKE_ACTIONS_STATE"] ?? "";
  const recorded = decodeState(await readFile(statePath, "utf8"));
  await writeFile(statePath, JSON.stringify({ ...recorded, calls: [...recorded.calls, args.join(" ")] }));
  if (recorded.listFails && args[0] === "run" && args[1] === "list") {
    process.stderr.write("gh: HTTP 502 listing runs\n");
    return 1;
  }
  if (args[0] === "run" && args[1] === "download") await meet(recorded, statePath);
  const out = await answer(recorded, args);
  if (out === undefined) {
    process.stderr.write(`fake gh: no answer for ${args.join(" ")}\n`);
    return 1;
  }
  process.stdout.write(out);
  return 0;
}

if (import.meta.main) process.exitCode = await main();
