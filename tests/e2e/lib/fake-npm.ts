#!/usr/bin/env bun
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Schema } from "effect";

const State = Schema.Struct({ latest: Schema.NullOr(Schema.String), calls: Schema.Array(Schema.String) });
type FakeState = typeof State.Type;

const decodeState = Schema.decodeUnknownSync(Schema.fromJsonString(State));
const decodeManifest = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ name: Schema.String, version: Schema.String })));

export type FakeNpm = {
  readonly env: Readonly<Record<string, string>>;
  readonly state: () => Promise<FakeState>;
};

// Puts an `npm` on PATH whose registry holds one package's `latest` dist-tag, null before its first publish.
export async function fakeNpm(home: string, latest: string | null): Promise<FakeNpm> {
  await writeFile(join(home, "npm"), `#!/bin/sh\nexec bun ${import.meta.path} "$@"\n`, { mode: 0o755 });
  const statePath = join(home, "npm-state.json");
  await writeFile(statePath, JSON.stringify({ latest, calls: [] } satisfies FakeState));
  return {
    env: { PATH: `${home}:${process.env["PATH"] ?? ""}`, FAKE_NPM_STATE: statePath },
    state: async () => decodeState(await readFile(statePath, "utf8")),
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
async function publish(state: FakeState, save: (latest: string | null) => Promise<void>): Promise<number> {
  if (process.env["FAKE_NPM_REFUSE"] !== undefined) return refuse(process.env["FAKE_NPM_REFUSE"]);
  const { name, version } = decodeManifest(await readFile("package.json", "utf8"));
  const latest = process.env["FAKE_NPM_PUBLISHED_FIRST"] ?? state.latest;
  await save(latest);
  if (latest === version) return refuse(`code E403\nnpm error You cannot publish over the previously published versions: ${version}.`);
  if (latest !== null && Bun.semver.order(latest, version) > 0) {
    return refuse(`Cannot implicitly apply the "latest" tag because previously published version ${latest} is higher than the new version ${version}. You must specify a tag using --tag.`);
  }
  await save(version);
  process.stdout.write(`+ ${name}@${version}\n`);
  return 0;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const statePath = process.env["FAKE_NPM_STATE"] ?? "";
  const recorded = decodeState(await readFile(statePath, "utf8"));
  const state = { ...recorded, calls: [...recorded.calls, args.join(" ")] };
  const save = (latest: string | null) => writeFile(statePath, JSON.stringify({ ...state, latest }));
  await save(state.latest);
  const [command, name = ""] = args;
  if (command === "view" && args.slice(2).join(" ") === "dist-tags --json") return view(name, state.latest);
  if (command === "publish" && args.length === 1) return publish(state, save);
  return refuse(`fake npm: unknown call ${args.join(" ")}`);
}

if (import.meta.main) process.exitCode = await main();
