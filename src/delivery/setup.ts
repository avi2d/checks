#!/usr/bin/env bun
import { Console, Effect, FileSystem, Path, Schema } from "effect";
import { runMain, Usage } from "../core/main.ts";
import { TEMPLATES } from "../docs/doc-templates.ts";
import { scriptOptions } from "../testing/test.ts";
import { withServiceOverrides, type ServiceOverride } from "../quality/effect-scope.ts";
import { SOURCES, TESTS } from "../quality/presets/oxlint.ts";
import severities from "../quality/presets/effect.language-service.json" with { type: "json" };

const NAME = "checks-setup";
const USAGE = "usage: " + NAME + " [--private]";
const PRIVATE = "--private";
const HOSTED_FALLBACK = "ubuntu-latest";
const HOSTED_DEFAULT = "${{ vars.CI_RUNS_ON || 'ubuntu-latest' }}";
const IGNORE_ENTRY = "node_modules/";
const KIT_ID = "@avi2dg/checks";

class SetupError extends Schema.TaggedError<SetupError>()("SetupError", {
  message: Schema.String,
}) {}

const KitManifest = Schema.Struct({ version: Schema.String });
const decodeKitManifest = Schema.decodeUnknownEffect(Schema.fromJsonString(KitManifest));

const JsonRecord = Schema.Record(Schema.String, Schema.Unknown);
const decodeRecord = Schema.decodeUnknownEffect(JsonRecord);

const DEFAULT_SCRIPTS: Record<string, string> = {
  lint: "oxlint && checks-lint",
  typecheck: "tsc --noEmit && effect-tsgo diagnostics --project tsconfig.json --format text --strict",
  test: "checks-test",
};

const OXLINT_CONFIG = [
  "import { defineConfig } from \"@avi2dg/checks/oxlint\";",
  "",
  "export default defineConfig({ effect: true });",
  "",
].join("\n");

const TSCONFIG_BASE = [
  "{",
  "  \"extends\": \"@avi2dg/checks/tsconfig.effect.json\",",
  "  \"compilerOptions\": { \"types\": [\"bun\"] }",
  "}",
  "",
].join("\n");

const DEFAULT_OVERRIDES: readonly ServiceOverride[] = [
  { include: [...SOURCES], exclude: [...TESTS], options: severities },
];

function quotedStrings(text: string): readonly string[] {
  const found: string[] = [];
  const pattern = new RegExp("\"((?:[^\"\\\\]|\\\\.)*)\"|'((?:[^'\\\\]|\\\\.)*)'", "g");
  for (;;) {
    const match = pattern.exec(text);
    if (match === null) return found;
    found.push(match[1] ?? match[2] ?? "");
  }
}

function delimitedInner(text: string, at: number, openChar: string, closeChar: string): string | undefined {
  const open = text.indexOf(openChar, at);
  if (open === -1) return undefined;
  let depth = 0;
  let quote: string | undefined;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (quote !== undefined) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = undefined;
    } else if (char === "\"" || char === "'") {
      quote = char;
    } else if (char === openChar) {
      depth += 1;
    } else if (char === closeChar) {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, index);
    }
  }
  return undefined;
}

function arrayAfter(text: string, key: string): readonly string[] | undefined {
  const at = text.search(new RegExp(key + "\\s*:"));
  if (at === -1) return undefined;
  const inner = delimitedInner(text, at, "[", "]");
  if (inner === undefined) return undefined;
  return quotedStrings(inner);
}

function blockAfter(text: string, at: number): string | undefined {
  return delimitedInner(text, at, "{", "}");
}

const effectScopeOf = (text: string): Effect.Effect<readonly ServiceOverride[], SetupError> => {
  const match = new RegExp("effect\\s*:\\s*(true|false|\\{)").exec(text);
  if (match === null || match[1] === "true") return Effect.succeed(DEFAULT_OVERRIDES);
  if (match[1] === "false") return Effect.succeed([]);
  const block = blockAfter(text, match.index);
  if (block === undefined) return Effect.succeed(DEFAULT_OVERRIDES);
  const files = arrayAfter(block, "files");
  const excludeFiles = arrayAfter(block, "excludeFiles") ?? [];
  if (files !== undefined && files.length === 0) {
    return Effect.fail(new SetupError({ message: "cannot read the effect scope of oxlint.config.ts, give files at least one glob or remove the file so setup writes a fresh config" }));
  }
  if (files === undefined) return Effect.succeed([{ include: [...SOURCES], exclude: [...TESTS, ...excludeFiles], options: severities }]);
  return Effect.succeed([{ include: files, exclude: excludeFiles, options: severities }]);
};

const KNIP_CONFIG = [
  "import { defineConfig } from \"@avi2dg/checks/knip\";",
  "",
  "export default defineConfig({ entry: [\"src/index.ts\"] });",
  "",
].join("\n");

function workflow(isPrivate: boolean, hasBuild: boolean): string {
  const lines = [
    "name: ci",
    "",
    "on:",
    "  pull_request:",
    "    types: [opened, synchronize]",
    "",
    "jobs:",
    "  checks:",
    "    runs-on: " + (isPrivate ? HOSTED_DEFAULT : HOSTED_FALLBACK),
    "    steps:",
    "      - uses: actions/checkout@v5",
    "        with:",
    "          fetch-depth: 0",
    "      - uses: oven-sh/setup-bun@v2",
    "        with:",
    "          bun-version-file: .bun-version",
    "      - run: bun install --frozen-lockfile",
  ];
  if (hasBuild) {
    lines.push("      - run: bun run build", "      - run: git diff --exit-code");
  }
  lines.push("      - run: bun run lint", "      - run: bun run typecheck", "      - run: bun run test");
  lines.push(
    "      - id: title",
    "        name: lint the title",
    "        env:",
    "          PR_TITLE: ${{ github.event.pull_request.title }}",
    "          GH_TOKEN: ${{ github.token }}",
    "        run: bunx checks-commit-title",
    "",
  );
  return lines.join("\n");
}

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
    return;
  }
  yield* system.makeDirectory(path.dirname(full), { recursive: true });
  yield* system.writeFileString(full, content);
  yield* Console.log(NAME + ": wrote " + relative);
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

type MutableRecord = Record<string, unknown>;

const parseRecord = (
  parse: () => unknown,
  toParseFault: (cause: unknown) => SetupError,
  shapeFault: SetupError,
): Effect.Effect<MutableRecord, SetupError> =>
  Effect.try({ try: parse, catch: (cause) => toParseFault(cause) }).pipe(
    Effect.flatMap((parsed) => decodeRecord(parsed).pipe(Effect.map((decoded) => ({ ...decoded })), Effect.mapError(() => shapeFault))),
  );

const parseTsconfigRecord = (current: string): Effect.Effect<MutableRecord, SetupError> =>
  parseRecord(
    (): unknown => Bun.JSONC.parse(current),
    () => new SetupError({ message: "cannot read tsconfig.json as JSONC, fix the file or remove it so setup writes a fresh config" }),
    new SetupError({ message: "cannot read tsconfig.json as JSONC, fix the file or remove it so setup writes a fresh config: expected an object" }),
  );

const setupTsconfig = Effect.fn("setupTsconfig")(function* (root: string, oxlintText: string) {
  const system = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const full = path.join(root, "tsconfig.json");
  const present = yield* system.exists(full);
  const current = present
    ? yield* system.readFileString(full).pipe(Effect.mapError((cause) => new SetupError({ message: "cannot read tsconfig.json: " + cause.message })))
    : TSCONFIG_BASE;
  yield* parseTsconfigRecord(current);
  const overrides = yield* effectScopeOf(oxlintText);
  const next = withServiceOverrides(current, overrides);
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
  const test = scripts["test"];
  if (typeof test === "string") {
    const options = scriptOptions(test);
    if (options === undefined || options.tier !== undefined || options.full === true) {
      return "package.json scripts.test must be \"checks-test\", optionally with --parallel=<workers>, found " + JSON.stringify(test);
    }
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

function finalizePackage(
  record: MutableRecord,
  scripts: MutableRecord,
  devDependencies: MutableRecord,
  isPrivate: boolean,
  fallbackName: string,
): { readonly merged: MutableRecord; readonly hasBuild: boolean; readonly hasOwner: boolean } {
  const merged: MutableRecord = { ...record, scripts, devDependencies };
  if (typeof merged["name"] !== "string") merged["name"] = fallbackName;
  if (merged["type"] === undefined) merged["type"] = "module";
  if (isPrivate) merged["private"] = true;
  const hasOwner = "author" in merged || "contributors" in merged;
  const hasBuild = typeof scripts["build"] === "string";
  return { merged, hasBuild, hasOwner };
}

const writeFreshPackage = Effect.fn("writeFreshPackage")(function* (
  root: string,
  isPrivate: boolean,
  version: string,
  fallbackName: string,
) {
  const system = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const full = path.join(root, "package.json");
  const manifest = {
    name: fallbackName,
    type: "module",
    ...(isPrivate ? { private: true } : {}),
    scripts: { ...DEFAULT_SCRIPTS },
    devDependencies: { [KIT_ID]: version },
  };
  yield* system.makeDirectory(path.dirname(full), { recursive: true });
  yield* system.writeFileString(full, JSON.stringify(manifest, undefined, 2) + "\n");
  yield* Console.log(NAME + ": wrote package.json");
  return { hasBuild: false, hasOwner: false };
});

const updatePackage = Effect.fn("updatePackage")(function* (
  root: string,
  raw: string,
  record: MutableRecord,
  isPrivate: boolean,
  fallbackName: string,
  version: string,
) {
  const system = yield* FileSystem.FileSystem;
  const full = (yield* Path.Path).join(root, "package.json");
  const baseScripts = yield* scriptsOf(record);
  const baseDeps = yield* depsOf(record);
  const devDependencies: MutableRecord = { ...baseDeps, [KIT_ID]: version };
  const fault = scriptFault(baseScripts);
  if (fault !== undefined) return yield* new SetupError({ message: fault });
  const scripts = withKitDefaults(baseScripts);
  const finalized = finalizePackage(record, scripts, devDependencies, isPrivate, fallbackName);
  const next = JSON.stringify(finalized.merged, undefined, 2) + "\n";
  if (next === raw) {
    yield* Console.log(NAME + ": kept package.json, already there");
    return { hasBuild: finalized.hasBuild, hasOwner: finalized.hasOwner };
  }
  yield* system.writeFileString(full, next);
  yield* Console.log(NAME + ": wrote package.json");
  return { hasBuild: finalized.hasBuild, hasOwner: finalized.hasOwner };
});
const setupPackage = Effect.fn("setupPackage")(function* (
  root: string,
  isPrivate: boolean,
  version: string,
  fallbackName: string,
) {
  const system = yield* FileSystem.FileSystem;
  const full = (yield* Path.Path).join(root, "package.json");
  if (!(yield* system.exists(full))) {
    return yield* writeFreshPackage(root, isPrivate, version, fallbackName);
  }
  const raw = yield* system.readFileString(full).pipe(
    Effect.mapError((cause) => new SetupError({ message: "cannot read package.json: " + cause.message })),
  );
  const record = yield* parsePackageRecord(raw);
  return yield* updatePackage(root, raw, record, isPrivate, fallbackName, version);
});

const check = Effect.gen(function* () {
  const args = process.argv.slice(2);
  const unknown = args.find((arg) => arg !== PRIVATE);
  if (unknown !== undefined) return yield* new Usage({ message: unknown + " is not an argument\n" + USAGE });
  const isPrivate = args.includes(PRIVATE);
  const root = yield* Effect.sync(() => process.cwd());
  const path = yield* Path.Path;

  const version = (yield* decodeKitManifest(yield* kitText("package.json")).pipe(
    Effect.mapError((cause) => new SetupError({ message: "cannot read the kit version: " + cause.message })),
  )).version;
  const outcome = yield* setupPackage(root, isPrivate, version, path.basename(root));

  yield* setupFile(root, ".bun-version", yield* kitText(".bun-version"));
  yield* setupFile(root, "bunfig.toml", yield* kitText("bunfig.toml"));
  yield* setupIgnore(root);
  const oxlintFull = path.join(root, "oxlint.config.ts");
  const system = yield* FileSystem.FileSystem;
  const oxlintRetained = yield* system.exists(oxlintFull);
  yield* setupFile(root, "oxlint.config.ts", OXLINT_CONFIG);
  const oxlintText = oxlintRetained
    ? yield* system.readFileString(oxlintFull).pipe(
      Effect.mapError((cause) => new SetupError({ message: "cannot read oxlint.config.ts: " + cause.message })),
    )
    : OXLINT_CONFIG;
  yield* setupTsconfig(root, oxlintText);
  yield* setupFile(root, "knip.config.ts", KNIP_CONFIG);
  yield* setupFile(root, ".github/workflows/ci.yml", workflow(isPrivate, outcome.hasBuild));
  for (const kind of Object.keys(TEMPLATES)) {
    yield* setupFile(root, "templates/" + kind + ".md", yield* kitText("dist/templates/" + kind + ".md"));
  }
  if (isPrivate) yield* Console.log(NAME + ": set the CI_RUNS_ON variable to a self-hosted runner label so the new jobs land there");
  if (!outcome.hasOwner) {
    yield* Console.log(NAME + ": declare the repository owners in package.json author or contributors before the first commit");
  }
  return true;
});

if (import.meta.main) runMain(NAME, check);
