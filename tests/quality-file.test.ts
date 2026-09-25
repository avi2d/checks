import { BunServices } from "@effect/platform-bun";
import Ajv2020 from "ajv/dist/2020";
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
  type Feature,
  type Quality,
} from "../scripts/quality-file.ts";
import { SCHEMA_FILE } from "../scripts/quality-schema.ts";

const CHECKOUT = resolve(import.meta.dir, "..");
const AUTHOR = { name: "Wren Fixture", email: "wren@example.com" };
const METADATA_GATES = [
  "checks-commit-identity",
  "checks-comment-gate",
  "checks-suppressions-ratchet",
  "checks-ci-wiring",
  "checks-docs",
] as const;
const BILLING = {
  name: "billing",
  root: "src/billing",
  entries: ["src/billing/index.ts"],
  allowFrom: ["src/main.ts"],
  proof: "tests/e2e/billing.test.ts",
} satisfies Feature;
const PRODUCTION = { production: ["src/**/*.ts"] };

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
    size: {
      applies: "ratchet",
      production: { fileLines: 400, functionLines: 100, statements: 30, complexity: 15, depth: 4 },
      tests: { fileLines: 600, statements: 50, complexity: 15, depth: 4 },
    },
    features: [BILLING],
    changeSignal: "advisory",
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
  const accepted = ["src/**/*.ts", "**/*.ts", "scripts/bin/*.ts", "a/b*c/*.test.ts", "src/main.ts", "packages/@scope/x/**/*.ts"];
  for (const glob of accepted) expect(decoded({ sources: { effect: { paths: [glob] } } })).toBeDefined();

  const refused = ["*.ts", "src", "src/{a,b}/*.ts", "src/?.ts", "src/[ab].ts", "./src/**/*.ts", "../src/*.ts", "src/../x/*.ts", "src/**.ts", "src/", "/src/*.ts", "!src/*.ts", "src/**", "src/lib", "a/b*c/**", "src/**/*", "src/*.*"];
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

test("a size budget states only where it differs from the kit's, in whole numbers, and is refused without production files", () => {
  const stated = { applies: "all", production: { complexity: 12 }, tests: { fileLines: 800 } } as const;
  const flat = { fileLines: 400, functionLines: 100, applies: "changed" } as const;
  for (const size of [stated, flat, {}]) expect(decoded({ sources: PRODUCTION, size })).toEqual({ sources: PRODUCTION, size });
  expect(refusal({ sources: PRODUCTION, size: { ...flat, production: { depth: 3 } } })).toContain(
    "sets fileLines and functionLines beside production, which holds the same budget; move them into production",
  );
  expect(refusal({ sources: PRODUCTION, size: { functionLines: 80, production: {} } })).toContain("sets functionLines beside production");

  expect(refusal({ size: stated })).toContain("declares size, which holds no production file without sources.production");
  expect(refusal({ sources: { production: [] }, size: {} })).toContain("declares size, which holds no production file without sources.production");
  expect(refusal({ sources: PRODUCTION, size: { production: { statements: 0 } } })).toContain('at ["size"]["production"]["statements"]');
  expect(refusal({ sources: PRODUCTION, size: { tests: { complexity: 1.5 } } })).toContain('at ["size"]["tests"]["complexity"]');
  expect(refusal({ sources: PRODUCTION, size: { tests: { functionLines: 100 } } })).toContain('at ["size"]["tests"]["functionLines"]');
  expect(refusal({ sources: PRODUCTION, size: { ...flat, fileLines: 0 } })).toContain('at ["size"]["fileLines"]');
  expect(refusal({ sources: PRODUCTION, size: { applies: "touched" } })).toContain('at ["size"]["applies"]');
});

test("a feature owns one root no other feature shares, lists entries under it, and proves itself under tests/e2e/", () => {
  const invoices = {
    name: "invoices",
    root: "src/invoices",
    entries: ["src/invoices/index.ts"],
    proof: "tests/e2e/invoices/flow.test.tsx",
  } satisfies Feature;
  expect(decoded({ features: [BILLING, invoices] })).toEqual({ features: [BILLING, invoices] });

  expect(refusal({ features: [{ ...BILLING, entries: ["src/main.ts"] }] })).toContain(
    "lists src/main.ts among its entries, outside its root src/billing",
  );
  expect(refusal({ features: [{ ...BILLING, entries: ["src/billing-extra/index.ts"] }] })).toContain("outside its root");
  expect(refusal({ features: [BILLING, { ...invoices, name: "billing" }] })).toContain("names billing more than once");
  expect(refusal({ features: [BILLING, { ...invoices, root: "src/billing/invoices", entries: ["src/billing/invoices/index.ts"] }] })).toContain(
    "gives src/billing/invoices to both billing and invoices",
  );
  for (const proof of ["tests/billing.test.ts", "src/billing/billing.test.ts", "tests/e2e/billing.ts", "tests/e2e/../billing.test.ts"]) {
    expect(refusal({ features: [{ ...BILLING, proof }] })).toContain("Expected a test file under tests/e2e/");
  }
  expect(refusal({ features: [{ ...BILLING, proof: undefined }] })).toContain('at ["features"][0]["proof"]');
  for (const root of ["src/billing/", "src/*", "./src/billing", "src/../billing"]) {
    expect(refusal({ features: [{ ...BILLING, root }] })).toContain("Expected a directory from the repository root");
  }
  expect(refusal({ features: [{ ...BILLING, entries: ["src/billing/*.ts"] }] })).toContain("Expected a file from the repository root");
  expect(refusal({ features: [{ ...BILLING, entries: [] }] })).toContain('at ["features"][0]["entries"]');
  expect(refusal({ features: [{ ...BILLING, name: "Billing" }] })).toContain("Expected a feature name in kebab case");
});

test("a change signal maps a change to feature owners, so it is refused without them", () => {
  expect(decoded({ features: [BILLING], changeSignal: "advisory" })).toEqual({ features: [BILLING], changeSignal: "advisory" });
  expect(refusal({ changeSignal: "advisory" })).toContain("declares changeSignal, which maps a change to no owner without features");
  expect(refusal({ features: [], changeSignal: "advisory" })).toContain("declares changeSignal");
  expect(refusal({ features: [BILLING], changeSignal: "refuse" })).toContain('at ["changeSignal"]');
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

test("an editor validating against quality.schema.json refuses a selection that leaves out a gate every repository runs", async () => {
  const validate = new Ajv2020({ strict: false }).compile(JSON.parse(await readFile(join(CHECKOUT, SCHEMA_FILE), "utf8")));
  const accepted = {
    defaultBranch: "trunk",
    gates: { ci: ["bun run lint"], lint: [...METADATA_GATES, "checks-quality"] },
    commitIdentity: { authors: [AUTHOR] },
    sources: { production: ["src/**/*.ts"], effect: { paths: ["src/**/*.ts"], exempt: ["src/host/*.ts"] } },
    agentRules: { on: ["effect-error-channel"], off: ["right-size-the-work"] },
  } satisfies Quality;
  expect(validate(accepted)).toBe(true);
  expect(decoded(accepted)).toEqual(accepted);

  for (const lint of [["checks-quality"], METADATA_GATES.filter((bin) => bin !== "checks-ci-wiring")]) {
    const selection = { gates: { lint } };
    expect(validate(selection)).toBe(false);
    expect(refusal(selection)).toContain("checks-lint must run");
  }
});

test("an editor validating against quality.schema.json refuses a size without production files, a budget spelled both ways and a signal without owners", async () => {
  const validate = new Ajv2020({ strict: false }).compile(JSON.parse(await readFile(join(CHECKOUT, SCHEMA_FILE), "utf8")));
  const size = { fileLines: 400, functionLines: 100, applies: "changed" };
  expect(validate({ sources: PRODUCTION, size, features: [BILLING], changeSignal: "advisory" })).toBe(true);
  expect(validate({ sources: PRODUCTION, size: { applies: "ratchet", production: { depth: 3 }, tests: { fileLines: 800 } } })).toBe(true);
  const both = { sources: PRODUCTION, size: { fileLines: 400, production: { depth: 3 } } };
  for (const quality of [{ size }, { sources: {}, size }, { sources: { production: [] }, size }, both, { changeSignal: "advisory" }, { features: [], changeSignal: "advisory" }]) {
    expect(validate(quality)).toBe(false);
    expect(refusal(quality)).toContain("which ");
  }
});
