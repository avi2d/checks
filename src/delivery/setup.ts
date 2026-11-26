#!/usr/bin/env bun
import { Console, Effect, FileSystem, Path, Schema } from "effect";
import { runMain, Usage } from "../core/main.ts";
import { JSCPD_CONFIG, KNIP_CONFIG, STRYKER_CONFIG } from "./setup-workflow.ts";
import { renderChangelog } from "./changelog.ts";
import { callerInputsOf, callerSetOf, flagMismatchOf, parseSiteNameFlags, readWorkflowFiles, type CallerSet } from "./site-names.ts";
import { byHandSet, requiredSet } from "./workflow-set.ts";
import { fullActions } from "./full-set/actions.ts";
import { TEMPLATES, VISION_PAGE } from "../docs/doc-templates.ts";
import { FAST_COMMAND, KIT_PACKAGE_NAME, TEST_COMMAND } from "../core/test-script.ts";
import { readTestScriptContext, testScriptsFault, withTierDefaults, type MutableRecord } from "./test-scripts.ts";
import { DEFAULT_OXLINT_CONFIG, OXLINT_CONFIG, scopedTsconfig, TSCONFIG } from "../quality/effect-scope.ts";

const NAME = "checks-setup";
const USAGE = "usage: " + NAME + " [--private] [--pages <project>] [--domain <domain>] [--production <owner/name>]";
const PRIVATE = "--private";
const IGNORE_ENTRY = "node_modules/";

class SetupError extends Schema.TaggedError<SetupError>()("SetupError", {
  message: Schema.String,
}) {}

const KitManifest = Schema.Struct({
  version: Schema.String,
  devDependencies: Schema.Struct({ "@stryker-mutator/core": Schema.String, "@hughescr/stryker-bun-runner": Schema.String }),
});

type Pins = { readonly kit: string; readonly mutation: typeof KitManifest.Type.devDependencies };
const decodeKitManifest = Schema.decodeUnknownEffect(Schema.fromJsonString(KitManifest));

const JsonRecord = Schema.Record(Schema.String, Schema.Unknown);
const decodeRecord = Schema.decodeUnknownEffect(JsonRecord);

const DEFAULT_SCRIPTS: Record<string, string> = {
  lint: "oxlint && checks-lint",
  typecheck: "tsc --noEmit && effect-tsgo diagnostics --project tsconfig.json --format text --strict",
  test: TEST_COMMAND,
  "test:fast": FAST_COMMAND,
};

const TSCONFIG_BASE = [
  "{",
  "  \"extends\": \"@avi2dg/checks/tsconfig.effect.json\",",
  "  \"compilerOptions\": { \"types\": [\"bun\"], \"allowImportingTsExtensions\": true, \"noEmit\": true }",
  "}",
  "",
].join("\n");

const kitText = Effect.fn("kitText")(function* (file: string) {
  const system = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const full = path.join(path.join(import.meta.dir, "..", ".."), file);
  return yield* system.readFileString(full).pipe(
    Effect.mapError((cause) => new SetupError({ message: "cannot read the kit " + file + " at " + full + ": " + cause.message })),
  );
});

const setupFile = Effect.fn("setupFile")(function* (root: string, relative: string, content: string) {
  const system = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const full = path.join(root, relative);
  if (yield* system.exists(full)) {
    yield* Console.log(NAME + ": kept " + relative + ", already there");
    return false;
  }
  yield* system.makeDirectory(path.dirname(full), { recursive: true });
  yield* system.writeFileString(full, content);
  yield* Console.log(NAME + ": wrote " + relative);
  return true;
});

const setupIgnore = Effect.fn("setupIgnore")(function* (root: string) {
  const system = yield* FileSystem.FileSystem;
  const full = (yield* Path.Path).join(root, ".gitignore");
  if (!(yield* system.exists(full))) {
    yield* system.writeFileString(full, IGNORE_ENTRY + "\n");
    yield* Console.log(NAME + ": wrote .gitignore");
    return;
  }
  const text = yield* system.readFileString(full).pipe(
    Effect.mapError((cause) => new SetupError({ message: "cannot read .gitignore: " + cause.message })),
  );
  if (text.split("\n").some((line) => line.trim() === IGNORE_ENTRY)) {
    yield* Console.log(NAME + ": kept .gitignore, already there");
    return;
  }
  const end = text === "" || text.endsWith("\n") ? text : text + "\n";
  yield* system.writeFileString(full, end + IGNORE_ENTRY + "\n");
  yield* Console.log(NAME + ": added " + IGNORE_ENTRY + " to .gitignore");
});

const parseRecord = (
  parse: () => unknown,
  toParseFault: (cause: unknown) => SetupError,
  shapeFault: SetupError,
): Effect.Effect<MutableRecord, SetupError> =>
  Effect.try({ try: parse, catch: (cause) => toParseFault(cause) }).pipe(
    Effect.flatMap((parsed) => decodeRecord(parsed).pipe(Effect.map((decoded) => ({ ...decoded })), Effect.mapError(() => shapeFault))),
  );

const setupTsconfig = Effect.fn("setupTsconfig")(function* (root: string) {
  const system = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const full = path.join(root, TSCONFIG);
  const present = yield* system.exists(full);
  const current = present
    ? yield* system.readFileString(full).pipe(Effect.mapError((cause) => new SetupError({ message: "cannot read tsconfig.json: " + cause.message })))
    : TSCONFIG_BASE;
  const next = yield* scopedTsconfig(root, current, "allow-uninstalled-default");
  if (present && next === current) {
    yield* Console.log(NAME + ": kept tsconfig.json, already there");
    return;
  }
  if (!present) yield* system.makeDirectory(path.dirname(full), { recursive: true });
  yield* system.writeFileString(full, next);
  yield* Console.log(NAME + ": wrote tsconfig.json");
});

function scriptFault(scripts: Record<string, unknown>): string | undefined {
  const lint = scripts["lint"];
  if (typeof lint === "string" && (!lint.includes("oxlint") || !lint.includes("checks-lint"))) {
    return "package.json scripts.lint must run oxlint and the layout check: use \"oxlint && checks-lint\"";
  }
  const typecheck = scripts["typecheck"];
  if (typeof typecheck === "string" && (!typecheck.includes("tsc") || !typecheck.includes("effect-tsgo"))) {
    return "package.json scripts.typecheck must run tsc and the Effect diagnostics: use \"tsc --noEmit && effect-tsgo diagnostics --project tsconfig.json --format text --strict\"";
  }
  return undefined;
}

const parsePackageRecord = (raw: string): Effect.Effect<MutableRecord, SetupError> =>
  parseRecord(
    (): unknown => JSON.parse(raw),
    (cause) => new SetupError({ message: "cannot read package.json as JSON, fix the file or remove it so setup writes a fresh manifest: " + String(cause) }),
    new SetupError({ message: "cannot read package.json as JSON, fix the file or remove it so setup writes a fresh manifest: expected an object" }),
  );

const fieldRecord = (record: MutableRecord, field: string, message: string): Effect.Effect<MutableRecord, SetupError> => {
  const found = record[field];
  if (found === undefined) return Effect.succeed({});
  return decodeRecord(found).pipe(Effect.map((decoded) => ({ ...decoded })), Effect.mapError(() => new SetupError({ message })));
};

const scriptsOf = (record: MutableRecord): Effect.Effect<MutableRecord, SetupError> => fieldRecord(record, "scripts", "cannot read package.json as JSON, fix the file or remove it so setup writes a fresh manifest: expected scripts to be an object");

const depsOf = (record: MutableRecord): Effect.Effect<MutableRecord, SetupError> => fieldRecord(record, "devDependencies", "cannot read package.json as JSON, fix the file or remove it so setup writes a fresh manifest: expected devDependencies to be an object");

function withKitDefaults(scripts: MutableRecord): MutableRecord {
  const next: MutableRecord = { ...scripts };
  for (const [name, command] of Object.entries(DEFAULT_SCRIPTS)) {
    if (typeof next[name] !== "string") next[name] = command;
  }
  return next;
}

function sortedDependencies(dependencies: MutableRecord): MutableRecord {
  return Object.fromEntries(Object.entries(dependencies).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
}

function finalizePackage(
  record: MutableRecord,
  scripts: MutableRecord,
  devDependencies: MutableRecord,
  isPrivate: boolean,
  fallbackName: string,
): { readonly merged: MutableRecord; readonly hasOwner: boolean; readonly name: string } {
  const name = typeof record["name"] === "string" ? record["name"] : fallbackName;
  const merged: MutableRecord = { ...record, name, scripts, devDependencies };
  if (merged["type"] === undefined) merged["type"] = "module";
  if (isPrivate) merged["private"] = true;
  const hasOwner = "author" in merged || "contributors" in merged;
  return { merged, hasOwner, name };
}

const writeFreshPackage = Effect.fn("writeFreshPackage")(function* (root: string, isPrivate: boolean, pins: Pins, fallbackName: string) {
  const system = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const full = path.join(root, "package.json");
  const scripts = withTierDefaults({ ...DEFAULT_SCRIPTS }, yield* readTestScriptContext(root, undefined));
  const manifest = {
    name: fallbackName,
    type: "module",
    ...(isPrivate ? { private: true } : {}),
    scripts,
    devDependencies: sortedDependencies({ [KIT_PACKAGE_NAME]: pins.kit, ...pins.mutation }),
  };
  yield* system.makeDirectory(path.dirname(full), { recursive: true });
  yield* system.writeFileString(full, JSON.stringify(manifest, undefined, 2) + "\n");
  yield* Console.log(NAME + ": wrote package.json");
  return { hasOwner: false, name: fallbackName };
});

const updatePackage = Effect.fn("updatePackage")(function* (
  root: string,
  raw: string,
  record: MutableRecord,
  isPrivate: boolean,
  fallbackName: string,
  pins: Pins,
) {
  const system = yield* FileSystem.FileSystem;
  const full = (yield* Path.Path).join(root, "package.json");
  const baseScripts = yield* scriptsOf(record);
  const baseDeps = yield* depsOf(record);
  const devDependencies = sortedDependencies({ ...pins.mutation, ...baseDeps, [KIT_PACKAGE_NAME]: pins.kit });
  const fault = scriptFault(baseScripts);
  if (fault !== undefined) return yield* new SetupError({ message: fault });
  const context = yield* readTestScriptContext(root, record["name"]);
  const testFault = testScriptsFault(baseScripts, context);
  if (testFault !== undefined) return yield* new SetupError({ message: testFault });
  const scripts = withTierDefaults(withKitDefaults(baseScripts), context);
  const finalized = finalizePackage(record, scripts, devDependencies, isPrivate, fallbackName);
  const next = JSON.stringify(finalized.merged, undefined, 2) + "\n";
  if (next === raw) {
    yield* Console.log(NAME + ": kept package.json, already there");
  } else {
    yield* system.writeFileString(full, next);
    yield* Console.log(NAME + ": wrote package.json");
  }
  return { hasOwner: finalized.hasOwner, name: finalized.name };
});
const setupPackage = Effect.fn("setupPackage")(function* (root: string, isPrivate: boolean, pins: Pins, fallbackName: string) {
  const system = yield* FileSystem.FileSystem;
  const full = (yield* Path.Path).join(root, "package.json");
  if (!(yield* system.exists(full))) {
    return yield* writeFreshPackage(root, isPrivate, pins, fallbackName);
  }
  const raw = yield* system.readFileString(full).pipe(
    Effect.mapError((cause) => new SetupError({ message: "cannot read package.json: " + cause.message })),
  );
  const record = yield* parsePackageRecord(raw);
  return yield* updatePackage(root, raw, record, isPrivate, fallbackName, pins);
});

const setupWorkflows = Effect.fn("setupWorkflows")(function* (root: string, set: CallerSet, kit: boolean) {
  for (const { name, text } of requiredSet(set, kit)) yield* setupFile(root, `.github/workflows/${name}`, text);
  for (const { path, text } of fullActions(set)) yield* setupFile(root, path, text);
  const mutation = byHandSet(set).find((file) => file.name === "mutation.yml");
  if (mutation !== undefined) yield* setupFile(root, `.github/workflows/${mutation.name}`, mutation.text);
  yield* setupFile(root, "stryker.conf.mjs", STRYKER_CONFIG);
});

const setupDocFiles = Effect.fn("setupDocFiles")(function* (root: string, name: string) {
  for (const kind of Object.keys(TEMPLATES)) {
    yield* setupFile(root, "templates/" + kind + ".md", yield* kitText("dist/templates/" + kind + ".md"));
  }
  const wroteAgents = yield* setupFile(root, "AGENTS.md", yield* kitText("dist/templates/agents.md"));
  yield* setupFile(root, "CLAUDE.md", yield* kitText("dist/templates/claude.md"));
  const wroteVision = yield* setupFile(root, VISION_PAGE, yield* kitText("dist/templates/vision.md"));
  yield* setupFile(root, "CHANGELOG.md", renderChangelog(name, [], ""));
  return { wroteAgents, wroteVision };
});

// The kind and the site names settle before any write, so a refused site run leaves the repository as it was.
const argumentsOf = Effect.fn("argumentsOf")(function* (root: string) {
  const parsed = parseSiteNameFlags(process.argv.slice(2));
  if (parsed === undefined) return yield* new Usage({ message: USAGE });
  const unknown = parsed.rest.find((arg) => arg !== PRIVATE);
  if (unknown !== undefined) return yield* new Usage({ message: unknown + " is not an argument\n" + USAGE });
  const callers = (yield* readWorkflowFiles(root)).map(({ workflow }) => workflow);
  const mismatch = flagMismatchOf(callers, parsed.flags);
  if (mismatch !== undefined) return yield* new Usage({ message: mismatch });
  const isPrivate = parsed.rest.includes(PRIVATE);
  const inputs = yield* callerInputsOf(root, isPrivate ? { private: true, hasTestScript: true } : { hasTestScript: true }).pipe(
    Effect.mapError((fault) => new Usage({ message: fault.message })),
  );
  const set = yield* callerSetOf(callers, parsed.flags, NAME, inputs.publishes, inputs.publishWorkspaces, inputs.needsReleaseChecks, inputs.publicRepository, inputs.docsBuild, inputs.hasE2e, inputs.releaseAssets, inputs.platformPackages, inputs.testTierShards).pipe(
    Effect.mapError((fault) => new Usage({ message: fault.message })),
  );
  return { isPrivate, set, kit: inputs.kit };
});

const check = Effect.gen(function* () {
  const root = yield* Effect.sync(() => process.cwd());
  const { isPrivate, set, kit: isKit } = yield* argumentsOf(root);
  const path = yield* Path.Path;

  const kit = yield* decodeKitManifest(yield* kitText("package.json")).pipe(
    Effect.mapError((cause) => new SetupError({ message: "cannot read the kit version: " + cause.message })),
  );
  const outcome = yield* setupPackage(root, isPrivate, { kit: kit.version, mutation: kit.devDependencies }, path.basename(root));

  yield* setupFile(root, ".bun-version", yield* kitText(".bun-version"));
  yield* setupFile(root, "bunfig.toml", yield* kitText("bunfig.toml"));
  yield* setupIgnore(root);
  yield* setupFile(root, OXLINT_CONFIG, DEFAULT_OXLINT_CONFIG);
  yield* setupTsconfig(root);
  yield* setupFile(root, "knip.config.ts", KNIP_CONFIG);
  yield* setupFile(root, ".jscpd.json", JSCPD_CONFIG);
  yield* setupWorkflows(root, set, isKit);
  const { wroteAgents, wroteVision } = yield* setupDocFiles(root, outcome.name);
  if (!set.options.publicRepository) yield* Console.log(NAME + ": set the CI_RUNS_ON variable to a self-hosted runner label so the new jobs land there");
  if (!outcome.hasOwner) {
    yield* Console.log(NAME + ": declare the repository owners in package.json author or contributors before the first commit");
  }
  if (wroteAgents) {
    yield* Console.log(NAME + ": fill AGENTS.md with what an agent cannot infer from the code before the first commit");
  }
  if (wroteVision) {
    yield* Console.log(NAME + ": fill the opening, stance sections, Scope and closing lines of " + VISION_PAGE + " and name it in one line of AGENTS.md before the first commit");
  }
  return true;
});

if (import.meta.main) runMain(NAME, check);
