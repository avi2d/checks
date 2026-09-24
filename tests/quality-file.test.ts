import { BunServices } from "@effect/platform-bun";
import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  decodeManifest,
  decodeQuality,
  qualityJsonSchema,
  readQuality,
  renderJson,
  type Quality,
} from "../scripts/quality-file.ts";
import { SCHEMA_FILE } from "../scripts/quality-schema.ts";

const CHECKOUT = resolve(import.meta.dir, "..");
const AUTHOR = { name: "Wren Fixture", email: "wren@example.com" };
const METADATA_GATES = ["checks-commit-identity", "checks-comment-gate", "checks-suppressions-ratchet", "checks-ci-wiring"] as const;

let dir = "";

afterEach(async () => {
  if (dir !== "") {
    await rm(dir, { recursive: true, force: true });
    dir = "";
  }
});

function decoded(quality: unknown): Quality {
  return Effect.runSync(decodeQuality(JSON.stringify(quality), "quality.json"));
}

function refusal(quality: unknown): string {
  return Effect.runSync(Effect.flip(decodeQuality(JSON.stringify(quality), "quality.json"))).message;
}

async function repository(files: Readonly<Record<string, unknown>>): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), "checks-quality-file-"));
  for (const [name, content] of Object.entries(files)) await writeFile(join(dir, name), JSON.stringify(content));
  return dir;
}

async function read(root: string) {
  return Effect.runPromise(readQuality(root).pipe(Effect.provide(BunServices.layer)));
}

async function readRefusal(root: string): Promise<string> {
  return Effect.runPromise(Effect.flip(readQuality(root)).pipe(Effect.provide(BunServices.layer))).then(
    (error) => error.message,
  );
}

test("every field decodes, and a key the schema does not name is refused rather than ignored", () => {
  const full = {
    $schema: "./node_modules/@avi2dg/checks/quality.schema.json",
    defaultBranch: "trunk",
    gates: { ci: ["bun run lint"], scheduled: ["bunx checks-flake"], lint: METADATA_GATES },
    commitIdentity: { authors: [AUTHOR] },
    sources: { production: ["src/**/*.ts"], effect: { paths: ["src/**/*.ts"], exempt: ["src/host/*.ts"] } },
    agentRules: { on: ["effect-error-channel"], off: ["right-size-the-work"] },
  } satisfies Quality;
  expect(decoded(full)).toEqual(full);
  expect(decoded({})).toEqual({});

  expect(refusal({ sourcs: { effect: { paths: ["src/**/*.ts"] } } })).toContain('at ["sourcs"]');
  expect(refusal({ sources: { effect: { paths: ["src/**/*.ts"], exmpt: [] } } })).toContain('at ["sources"]["effect"]["exmpt"]');
  expect(refusal({ gates: { ci: [] } })).toContain('at ["gates"]["ci"]');
  expect(refusal({ sources: { effect: { paths: [] } } })).toContain('at ["sources"]["effect"]["paths"]');
  expect(refusal({ commitIdentity: { authors: [] } })).toContain('at ["commitIdentity"]["authors"]');
  expect(Effect.runSync(Effect.flip(decodeQuality("{", "quality.json"))).message).toStartWith("quality.json: ");
});

test("a glob reads the same to oxlint, the language service and git, or it is refused", () => {
  const accepted = ["src/**/*.ts", "**/*.ts", "scripts/bin/*.ts", "a/b*c/**", "packages/@scope/x/**/*.ts"];
  for (const glob of accepted) expect(decoded({ sources: { effect: { paths: [glob] } } })).toBeDefined();

  const refused = ["*.ts", "src", "src/{a,b}/*.ts", "src/?.ts", "src/[ab].ts", "./src/**/*.ts", "../src/*.ts", "src/../x/*.ts", "src/**.ts", "src/", "/src/*.ts", "!src/*.ts"];
  for (const glob of refused) {
    expect(refusal({ sources: { effect: { paths: [glob] } } })).toContain("Expected a glob from the repository root");
  }
});

test("a Rule switched both on and off is refused, and a Rule name is kebab case", () => {
  expect(refusal({ agentRules: { on: ["prove-it-works", "fix-what-you-see"], off: ["fix-what-you-see"] } })).toContain(
    "switches fix-what-you-see both on and off",
  );
  expect(refusal({ agentRules: { on: ["Prove It Works"] } })).toContain("Expected a Rule name in kebab case");
});

test("package.json ciWiring and commitIdentity decode into the same declaration quality.json holds", () => {
  const manifest = {
    name: "fixture",
    scripts: { lint: "checks-lint" },
    ciWiring: { gates: ["bun run lint"], scheduled: ["bunx checks-flake"], lintGates: METADATA_GATES, defaultBranch: "trunk" },
    commitIdentity: { authors: [AUTHOR] },
  };
  expect(Effect.runSync(decodeManifest(JSON.stringify(manifest), "package.json"))).toEqual({
    keys: ["ciWiring", "commitIdentity"],
    quality: {
      defaultBranch: "trunk",
      gates: { ci: ["bun run lint"], scheduled: ["bunx checks-flake"], lint: METADATA_GATES },
      commitIdentity: { authors: [AUTHOR] },
    },
  });
  expect(Effect.runSync(decodeManifest(JSON.stringify({ name: "fixture" }), "package.json"))).toEqual({ keys: [], quality: {} });
  const empty = Effect.runSync(Effect.flip(decodeManifest(JSON.stringify({ commitIdentity: { authors: [] } }), "package.json")));
  expect(empty.message).toBe('package.json: Missing key\n  at ["commitIdentity"]["authors"][0]');
});

test("quality.json at the root wins, package.json stands in while it is absent, and both at once is refused", async () => {
  const quality = { gates: { ci: ["bun run lint"] }, commitIdentity: { authors: [AUTHOR] } } satisfies Quality;
  const root = await repository({ "quality.json": quality, "package.json": { name: "fixture" } });
  expect(await read(root)).toEqual({ source: "quality.json", quality });

  await writeFile(join(root, "package.json"), JSON.stringify({ name: "fixture", ciWiring: { gates: ["bun run test"] } }));
  expect(await readRefusal(root)).toBe("package.json still sets ciWiring, which quality.json replaces; move what it holds there");

  await rm(join(root, "quality.json"));
  expect(await read(root)).toEqual({ source: "package.json", quality: { gates: { ci: ["bun run test"] } } });

  await rm(join(root, "package.json"));
  expect(await read(root)).toEqual({ source: "package.json", quality: {} });

  await writeFile(join(root, "quality.json"), JSON.stringify({ gates: { ci: ["bun run lint"] }, extra: true }));
  expect(await readRefusal(root)).toContain('quality.json: Expected no excess property\n  at ["extra"]');
});

test("quality.schema.json is what the schema emits, so an editor and the decoder agree", async () => {
  expect(await readFile(join(CHECKOUT, SCHEMA_FILE), "utf8")).toBe(renderJson(qualityJsonSchema()));
});
