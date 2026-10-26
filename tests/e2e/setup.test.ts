import { $ } from "bun";
import { expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { Schema } from "effect";
import { join } from "node:path";
import { CHECKOUT, fixtureRepos, ran, scratchDirs, type FixtureRepo } from "./lib/fixture-repo.ts";

const open = fixtureRepos("checks-setup-");
const scratch = scratchDirs();
const KitVersion = Schema.Struct({ version: Schema.String });
const WrittenManifest = Schema.Struct({
  name: Schema.optional(Schema.String),
  type: Schema.optional(Schema.String),
  private: Schema.optional(Schema.Boolean),
  scripts: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  devDependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});

function setup(repo: FixtureRepo, ...args: readonly string[]) {
  return repo.script("delivery/setup.ts", ...args);
}

async function kitFile(file: string): Promise<string> {
  return readFile(join(CHECKOUT, file), "utf8");
}

const Tsconfig = Schema.Struct({
  extends: Schema.String,
  compilerOptions: Schema.optional(
    Schema.Struct({
      plugins: Schema.optional(Schema.Array(Schema.Struct({
        name: Schema.String,
        overrides: Schema.optional(
          Schema.Array(
            Schema.Struct({
              include: Schema.Array(Schema.String),
              exclude: Schema.optional(Schema.Array(Schema.String)),
            }),
          ),
        ),
      }))),
    }),
  ),
});

const WorkflowStepSchema = Schema.Struct({ run: Schema.optional(Schema.Unknown) });

const WorkflowJobSchema = Schema.Struct({
  steps: Schema.optional(Schema.Array(WorkflowStepSchema)),
  "runs-on": Schema.optional(Schema.Unknown),
});

const WorkflowDocumentSchema = Schema.Struct({
  jobs: Schema.optional(Schema.Record(Schema.String, WorkflowJobSchema)),
});

function workflowSteps(text: string): { readonly runs: readonly string[]; readonly runsOn: unknown } {
  const doc = Schema.decodeUnknownSync(WorkflowDocumentSchema)(Bun.YAML.parse(text));
  const job = doc.jobs?.["checks"];
  const runs = (job?.steps ?? []).flatMap((step) => (typeof step.run === "string" ? [step.run.trim()] : []));
  const runsOn = job?.["runs-on"];
  return { runs, runsOn };
}

function decodeManifest(text: string): typeof WrittenManifest.Type {
  return Schema.decodeSync(Schema.fromJsonString(WrittenManifest))(text);
}

function decodeTsconfig(text: string): typeof Tsconfig.Type {
  return Schema.decodeUnknownSync(Tsconfig)(Bun.JSONC.parse(text));
}

const EXPECTED_INCLUDE = ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"];
const EXPECTED_EXCLUDE = ["tests/**", "**/*.test.ts", "**/*.test.tsx"];

test(
"an empty directory gains the kit config, the CI workflow and the doc templates byte for byte from the kit",
async () => {
const dir = await scratch("empty");
const run = await $`bun ${join(CHECKOUT, "src", "delivery", "setup.ts")}`.cwd(dir).nothrow().quiet();
expect(run.exitCode).toBe(0);
expect(await readFile(join(dir, ".bun-version"), "utf8")).toBe(await kitFile(".bun-version"));
expect(await readFile(join(dir, "bunfig.toml"), "utf8")).toBe(await kitFile("bunfig.toml"));
expect(await readFile(join(dir, ".gitignore"), "utf8")).toBe("node_modules/\n");
expect(await readFile(join(dir, "templates/how-to.md"), "utf8")).toBe(await kitFile("dist/templates/how-to.md"));
expect(await readFile(join(dir, "templates/agents.md"), "utf8")).toBe(await kitFile("dist/templates/agents.md"));
const kitManifest = Schema.decodeSync(Schema.fromJsonString(KitVersion))(await kitFile("package.json"));
const manifest = decodeManifest(await readFile(join(dir, "package.json"), "utf8"));
expect(manifest.devDependencies?.["@avi2dg/checks"]).toBe(kitManifest.version);
expect(manifest.scripts?.["test"]).toBe("checks-test");
expect(manifest.scripts?.["lint"]?.split("&&").map((part) => part.trim())).toContain("checks-lint");
expect(manifest.scripts?.["typecheck"]).toBeDefined();
const tsconfig = decodeTsconfig(await readFile(join(dir, "tsconfig.json"), "utf8"));
expect(tsconfig.extends).toBe("@avi2dg/checks/tsconfig.effect.json");
const service = tsconfig.compilerOptions?.plugins?.find((plugin) => plugin.name === "@effect/language-service");
expect(service?.overrides?.[0]?.include).toEqual(EXPECTED_INCLUDE);
expect(service?.overrides?.[0]?.exclude).toEqual(EXPECTED_EXCLUDE);
const { runs, runsOn } = workflowSteps(await readFile(join(dir, ".github/workflows/ci.yml"), "utf8"));
expect(runs).toContain("bun install --frozen-lockfile");
expect(runs).toContain("bun run lint");
expect(runs).toContain("bun run typecheck");
expect(runs).toContain("bun run test");
expect(runs).toContain("bunx checks-commit-title");
expect(runsOn).toBe("ubuntu-latest");
},
60_000,
);

test(
"a second run writes nothing and keeps every file",
async () => {
const repo = await open({});
expect((await setup(repo)).exitCode).toBe(0);
const before = await readFile(join(repo.dir, "oxlint.config.ts"), "utf8");
const rerun = await setup(repo);
expect(rerun.exitCode).toBe(0);
expect(rerun.text).toContain("kept oxlint.config.ts, already there");
expect(await readFile(join(repo.dir, "oxlint.config.ts"), "utf8")).toBe(before);
},
60_000,
);

test(
"a repo that already has files keeps them and only fills the gaps",
async () => {
const repo = await open({
"oxlint.config.ts": "// custom\n",
".gitignore": "dist/\n",
"package.json": JSON.stringify({ name: "shop", type: "module" }),
});
const run = await setup(repo);
expect(run.exitCode).toBe(0);
expect(await readFile(join(repo.dir, "oxlint.config.ts"), "utf8")).toBe("// custom\n");
const kept = decodeManifest(await readFile(join(repo.dir, "package.json"), "utf8"));
expect(kept.name).toBe("shop");
expect(kept.devDependencies?.["@avi2dg/checks"]).toBeDefined();
expect(kept.scripts?.["test"]).toBe("checks-test");
expect(kept.scripts?.["lint"]?.split("&&").map((part) => part.trim())).toContain("checks-lint");
expect(await readFile(join(repo.dir, ".gitignore"), "utf8")).toBe("dist/\nnode_modules/\n");
expect(run.text).toContain("added node_modules/ to .gitignore");
const keptTsconfig = decodeTsconfig(await readFile(join(repo.dir, "tsconfig.json"), "utf8"));
expect(keptTsconfig.extends).toBe("@avi2dg/checks/tsconfig.effect.json");
const keptRuns = workflowSteps(await readFile(join(repo.dir, ".github/workflows/ci.yml"), "utf8")).runs;
expect(keptRuns).toContain("bun run lint");
expect(keptRuns).toContain("bun run test");
},
60_000,
);

test(
"a private run pins the hosted default runner and names the variable to set",
async () => {
const repo = await open({});
const run = await setup(repo, "--private");
expect(run.exitCode).toBe(0);
const { runsOn, runs } = workflowSteps(await readFile(join(repo.dir, ".github/workflows/ci.yml"), "utf8"));
expect(runsOn).toBe("${{ vars.CI_RUNS_ON || 'ubuntu-latest' }}");
expect(runs).toContain("bun run lint");
expect(runs).toContain("bun run test");
expect(runs).toContain("bunx checks-commit-title");
expect(run.text).toContain("set the CI_RUNS_ON variable to a self-hosted runner label");
const manifest = decodeManifest(await readFile(join(repo.dir, "package.json"), "utf8"));
expect(manifest.private).toBe(true);
},
60_000,
);

test(
"it refuses a retained lint script that does not run the checks",
async () => {
const repo = await open({
"package.json": JSON.stringify({ name: "shop", type: "module", scripts: { lint: "oxlint", test: "checks-test" } }),
});
const run = await setup(repo);
expect(run.exitCode).toBe(2);
expect(run.text).toContain("scripts.lint must run oxlint and the layout check");
},
60_000,
);

test(
"it refuses a retained test script that does not run the suite",
async () => {
const repo = await open({
"package.json": JSON.stringify({ name: "shop", type: "module", scripts: { lint: "oxlint && checks-lint", test: "bun test" } }),
});
const run = await setup(repo);
expect(run.exitCode).toBe(2);
expect(run.text).toContain("scripts.test must be");
},
60_000,
);

test(
"it refuses a retained lint script that skips the oxlint half",
async () => {
const repo = await open({
"package.json": JSON.stringify({ name: "shop", type: "module", scripts: { lint: "checks-lint", test: "checks-test" } }),
});
const run = await setup(repo);
expect(run.exitCode).toBe(2);
expect(run.text).toContain("scripts.lint must run oxlint and the layout check");
},
60_000,
);

test(
"it refuses a retained typecheck script that skips the Effect diagnostics",
async () => {
const repo = await open({
"package.json": JSON.stringify({ name: "shop", type: "module", scripts: { lint: "oxlint && checks-lint", test: "checks-test", typecheck: "tsc --noEmit" } }),
});
const run = await setup(repo);
expect(run.exitCode).toBe(2);
expect(run.text).toContain("scripts.typecheck must run tsc and the Effect diagnostics");
},
60_000,
);

test(
"a retained effect-free oxlint config gains a tsconfig without Effect paths",
async () => {
const repo = await open({
"oxlint.config.ts": "import { defineConfig } from \"@avi2dg/checks/oxlint\";\n\nexport default defineConfig({ effect: false });\n",
});
const run = await setup(repo);
expect(run.exitCode).toBe(0);
const tsconfig = decodeTsconfig(await readFile(join(repo.dir, "tsconfig.json"), "utf8"));
expect(tsconfig.extends).toBe("@avi2dg/checks/tsconfig.effect.json");
const service = tsconfig.compilerOptions?.plugins?.find((plugin) => plugin.name === "@effect/language-service");
expect(service?.overrides ?? []).toEqual([]);
},
60_000,
);

test(
"a retained tsconfig gains the Effect paths of the generated oxlint config",
async () => {
const repo = await open({
"tsconfig.json": "{\n  \"extends\": \"@avi2dg/checks/tsconfig.effect.json\",\n  \"compilerOptions\": { \"types\": [\"bun\"] }\n}\n",
});
const run = await setup(repo);
expect(run.exitCode).toBe(0);
const tsconfig = decodeTsconfig(await readFile(join(repo.dir, "tsconfig.json"), "utf8"));
const service = tsconfig.compilerOptions?.plugins?.find((plugin) => plugin.name === "@effect/language-service");
expect(service?.overrides?.[0]?.include).toEqual(EXPECTED_INCLUDE);
expect(service?.overrides?.[0]?.exclude).toEqual(EXPECTED_EXCLUDE);
},
60_000,
);

async function gateEvent(repo: FixtureRepo, isPrivate: boolean): Promise<string> {
const event = join(repo.dir, "github-event.json");
await writeFile(event, JSON.stringify({ repository: { private: isPrivate } }));
return event;
}

test(
"the generated public and private workflows pass the kit ci-wiring gate",
async () => {
const pub = await open({});
await setup(pub);
const pubWiring = await ran($`bun ${join(CHECKOUT, "src", "delivery", "ci-wiring.ts")}`.cwd(pub.dir).env({ ...process.env, GITHUB_EVENT_PATH: await gateEvent(pub, false) }));
expect(pubWiring.exitCode).toBe(0);
const priv = await open({});
await setup(priv, "--private");
const privWiring = await ran($`bun ${join(CHECKOUT, "src", "delivery", "ci-wiring.ts")}`.cwd(priv.dir).env({ ...process.env, GITHUB_EVENT_PATH: await gateEvent(priv, true) }));
expect(privWiring.exitCode).toBe(0);
},
60_000,
);
