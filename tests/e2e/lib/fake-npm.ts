#!/usr/bin/env bun
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Schema } from "effect";

const State = Schema.Struct({
  latest: Schema.NullOr(Schema.String),
  initialLatest: Schema.NullOr(Schema.String),
  latestByPackage: Schema.Record(Schema.String, Schema.String),
  calls: Schema.Array(Schema.String),
  published: Schema.Array(Schema.String),
  manifests: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
});
type FakeState = typeof State.Type;

const decodeState = Schema.decodeUnknownSync(Schema.fromJsonString(State));
const decodeManifest = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)));
const decodeIdentity = Schema.decodeUnknownSync(Schema.Struct({ name: Schema.String, version: Schema.String }));

export type FakeNpm = {
  readonly env: Readonly<Record<string, string>>;
  readonly state: () => Promise<Pick<FakeState, "latest" | "calls" | "published">>;
  readonly registry: () => Promise<FakeState>;
};

export async function fakeNpm(home: string, latest: string | null): Promise<FakeNpm> {
  await writeFile(join(home, "npm"), `#!/bin/sh\nexec bun ${import.meta.path} "$@"\n`, { mode: 0o755 });
  const statePath = join(home, "npm-state.json");
  await writeFile(statePath, JSON.stringify({ latest, initialLatest: latest, latestByPackage: {}, calls: [], published: [], manifests: [] } satisfies FakeState));
  return {
    env: { PATH: `${home}:${process.env["PATH"] ?? ""}`, FAKE_NPM_STATE: statePath },
    state: async () => {
      const { latest: current, calls, published } = decodeState(await readFile(statePath, "utf8"));
      return { latest: current, calls, published };
    },
    registry: async () => decodeState(await readFile(statePath, "utf8")),
  };
}

function refuse(message: string): number {
  process.stderr.write(`npm error ${message}\n`);
  return 1;
}

function view(name: string, latest: string | null): number {
  if (latest !== null) {
    process.stdout.write(JSON.stringify({ latest }));
    return 0;
  }
  process.stdout.write(JSON.stringify({ error: { code: "E404", summary: `Not Found - GET https://registry.npmjs.org/${name} - Not found` } }));
  return refuse("code E404");
}

// FAKE_NPM_PUBLISHED_FIRST names a version another release publishes just before this one.
async function publish(state: FakeState, save: (next: FakeState) => Promise<void>): Promise<number> {
  const shasum = process.env["FAKE_NPM_PUBLISH_SHASUM"];
  if (shasum !== undefined) process.stderr.write(`npm notice shasum: ${shasum}\n`);
  const manifest = decodeManifest(await readFile("package.json", "utf8"));
  const { name, version } = decodeIdentity(manifest);
  const latest = process.env["FAKE_NPM_PUBLISHED_FIRST"] ?? state.latestByPackage[name] ?? state.initialLatest;
  const next = { ...state, latest, latestByPackage: latest === null ? state.latestByPackage : { ...state.latestByPackage, [name]: latest }, manifests: [...state.manifests, manifest] };
  await save(next);
  if (process.env["FAKE_NPM_REFUSE"] !== undefined) return refuse(process.env["FAKE_NPM_REFUSE"]);
  if (latest === version) return refuse(`code E403\nnpm error You cannot publish over the previously published versions: ${version}.`);
  if (latest !== null && Bun.semver.order(latest, version) > 0) {
    return refuse(`Cannot implicitly apply the "latest" tag because previously published version ${latest} is higher than the new version ${version}. You must specify a tag using --tag.`);
  }
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  await save({ ...next, latest: version, latestByPackage: { ...next.latestByPackage, [name]: version }, published: [...state.published, head] });
  process.stdout.write(`+ ${name}@${version}\n`);
  return 0;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const statePath = process.env["FAKE_NPM_STATE"] ?? "";
  const recorded = decodeState(await readFile(statePath, "utf8"));
  const state = { ...recorded, calls: [...recorded.calls, args.join(" ")] };
  const save = (next: FakeState) => writeFile(statePath, JSON.stringify(next));
  await save(state);
  const [command, name = ""] = args;
  if (command === "view" && args.slice(2).join(" ") === "dist-tags --json") return view(name, state.latestByPackage[name] ?? state.initialLatest);
  if (command === "view" && args.slice(2).join(" ") === "dist.shasum --json") {
    const shasum = process.env["FAKE_NPM_SHASUM"];
    const views = state.calls.filter((call) => call === args.join(" ")).length;
    if (shasum !== undefined && views > Number(process.env["FAKE_NPM_VISIBLE_AFTER"] ?? "0")) {
      process.stdout.write(JSON.stringify(shasum));
      return 0;
    }
    process.stdout.write(JSON.stringify({ error: { code: "E404" } }));
    return refuse("code E404");
  }
  if (command === "publish" && args.length === 1) return publish(state, save);
  return refuse(`fake npm: unknown call ${args.join(" ")}`);
}

if (import.meta.main) process.exitCode = await main();
