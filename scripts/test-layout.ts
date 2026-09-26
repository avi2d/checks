#!/usr/bin/env bun
import { Console, Effect, FileSystem, Path, Schema } from "effect";
import { git } from "./git.ts";
import { runMain } from "./main.ts";
import { ENTRY_POINT, QUALITY_FILE, TEST_ENTRY_POINT } from "./gates.ts";
import { readQuality } from "./quality-file.ts";
import { identifierName, isRecord, lineOf, parseTypeScript, spanStart, stringValue } from "./swc.ts";

export type Violation = {
  readonly file: string;
  readonly line: number | undefined;
  readonly message: string;
};

const TESTS = "tests/";
const E2E = "tests/e2e/";
const HELPER_DIRS = ["tests/lib/", "tests/fixtures/"] as const;
const DATA_DIR = "tests/fixtures/";

export const TEST_FILE = /(?:[.](?:test|spec)|_test)[.](tsx?)$/;
const TARGET_FILE = /^tests\/(?:[^/]+\/)*[^/]+[.]test[.]tsx?$/;
const TYPESCRIPT = /[.]tsx?$/;

const BANNED_MODULES: readonly string[] = [
  "child_process",
  "net",
  "http",
  "https",
  "http2",
  "tls",
  "dgram",
];
const BANNED_BUN_NAMES: readonly string[] = [
  "$",
  "spawn",
  "spawnSync",
  "connect",
  "serve",
  "listen",
];
const BANNED_GLOBAL_CALLS: readonly string[] = ["fetch"];

const IGNORES_KEY = "pathIgnorePatterns";
const QUARANTINE = "**/tests/quarantine/**";
const LIVE_TESTS = "**/tests/live/**";
const PIXEL_TESTS = "**/tests/pixel/**";
const VENDORED = "repos/**";
const TEST_TIERS = ["live", "pixel"] as const;
const OUT_OF_PROCESS: readonly string[] = [E2E, ...TEST_TIERS.map((tier) => `${TESTS}${tier}/`)];
const PRESET_IGNORES: readonly string[] = [QUARANTINE, LIVE_TESTS, PIXEL_TESTS, VENDORED];
const BASE_IGNORES: readonly string[] = [QUARANTINE, LIVE_TESTS, PIXEL_TESTS];

function acceptedIgnores(vendors: boolean): readonly (readonly string[])[] {
  return vendors ? [PRESET_IGNORES] : [PRESET_IGNORES, BASE_IGNORES];
}
export const LAYOUT_CHECK_MARK = "scripts/test-layout.ts";
export const LAYOUT_CHECK_BIN = "checks-test-layout";
const OWN_ENTRY_POINT = `scripts/${ENTRY_POINT.script}`;
const TEST_SCRIPTS: readonly string[] = [TEST_ENTRY_POINT.bin, `bun scripts/${TEST_ENTRY_POINT.script}`];

export class LayoutError extends Schema.TaggedError<LayoutError>()("LayoutError", {
  message: Schema.String,
}) {}

function runsLayoutCheck(lint: string): boolean {
  if (lint.includes(LAYOUT_CHECK_MARK) || lint.includes(LAYOUT_CHECK_BIN)) return true;
  return lint.split(/[\s|&;()]+/).some((word) => word === ENTRY_POINT.bin || word === OWN_ENTRY_POINT);
}

function startsWithAny(file: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => file.startsWith(prefix));
}

function targetFor(file: string): string {
  const withoutLeadingDirs = file
    .replace(/^tests\/(?:lib|fixtures)\//, "")
    .replace(/^(?:src|lib|app)\//, "")
    .replace(/(?:^|\/)__tests__\//, "/")
    .replace(/^\/+/, "");
  const renamed = withoutLeadingDirs.replace(TEST_FILE, ".test.$1");
  return renamed.startsWith(TESTS) ? renamed : `${TESTS}${renamed}`;
}

export function placementViolations(files: readonly string[]): readonly Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    if (!TEST_FILE.test(file)) continue;
    const target = targetFor(file);
    if (startsWithAny(file, HELPER_DIRS)) {
      violations.push({
        file,
        line: undefined,
        message: `tests/lib and tests/fixtures hold helpers and data, never tests; move it to ${target}`,
      });
      continue;
    }
    if (!TARGET_FILE.test(file)) {
      violations.push({
        file,
        line: undefined,
        message: `a test file must live at tests/**/*.test.ts; move it to ${target}`,
      });
    }
  }
  return violations;
}

function bannedModule(specifier: string): string | undefined {
  const bare = specifier.startsWith("node:") ? specifier.slice("node:".length) : specifier;
  return BANNED_MODULES.includes(bare) ? bare : undefined;
}

function importedNames(node: Record<string, unknown>): readonly string[] {
  const specifiers = node["specifiers"];
  if (!Array.isArray(specifiers)) return [];
  const names: string[] = [];
  for (const specifier of specifiers) {
    if (!isRecord(specifier)) continue;
    const name =
      identifierName(specifier["imported"]) ??
      identifierName(specifier["orig"]) ??
      identifierName(specifier["local"]);
    if (name !== undefined) names.push(name);
  }
  return names;
}

type UseCheck = (node: Record<string, unknown>) => string | undefined;

function moduleUse(node: Record<string, unknown>): string | undefined {
  const source = stringValue(node["source"]);
  if (source === undefined) return undefined;
  const banned = bannedModule(source);
  if (banned !== undefined) return `imports node:${banned}`;
  if (source !== "bun") return undefined;
  const name = importedNames(node).find((candidate) => BANNED_BUN_NAMES.includes(candidate));
  return name === undefined ? undefined : `imports ${name} from bun`;
}

function bunMemberUse(node: Record<string, unknown>): string | undefined {
  if (identifierName(node["object"]) !== "Bun") return undefined;
  const property = identifierName(node["property"]);
  return property !== undefined && BANNED_BUN_NAMES.includes(property) ? `uses Bun.${property}` : undefined;
}

function callUse(node: Record<string, unknown>): string | undefined {
  const callee = node["callee"];
  const calleeName = identifierName(callee);
  if (calleeName !== undefined && BANNED_GLOBAL_CALLS.includes(calleeName)) return `calls ${calleeName}`;
  const argument = Array.isArray(node["arguments"]) ? node["arguments"][0] : undefined;
  const specifier = isRecord(argument) ? stringValue(argument["expression"]) : undefined;
  const banned = specifier === undefined ? undefined : bannedModule(specifier);
  if (banned === undefined) return undefined;
  if (isRecord(callee) && callee["type"] === "Import") return `imports node:${banned}`;
  return calleeName === "require" ? `requires node:${banned}` : undefined;
}

const USE_CHECKS = new Map<string, UseCheck>([
  ["ImportDeclaration", moduleUse],
  ["ExportNamedDeclaration", moduleUse],
  ["ExportAllDeclaration", moduleUse],
  ["MemberExpression", bunMemberUse],
  ["CallExpression", callUse],
]);

function outOfProcessUse(node: Record<string, unknown>): string | undefined {
  const type = node["type"];
  return typeof type === "string" ? USE_CHECKS.get(type)?.(node) : undefined;
}

export const isolationViolations = Effect.fn("isolationViolations")(function* (file: string, source: string) {
  const module = yield* parseTypeScript(file, source).pipe(
    Effect.mapError((error) => new LayoutError({ message: error.message })),
  );
  const violations: Violation[] = [];
  const seen = new Set<unknown>();

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (!isRecord(node) || seen.has(node)) return;
    seen.add(node);
    if (typeof node["type"] === "string") {
      const use = outOfProcessUse(node);
      if (use !== undefined) {
        violations.push({
          file,
          line: lineOf(source, spanStart(node)),
          message: `a test outside ${E2E} must stay in-process, and this ${use}; move it to ${E2E}${file.slice(TESTS.length)}`,
        });
      }
    }
    for (const value of Object.values(node)) visit(value);
  };

  visit(module);
  return violations;
});

function tierScriptViolation(scripts: unknown, files: readonly string[], tier: (typeof TEST_TIERS)[number]): Violation | undefined {
  const file = "package.json";
  const key = `test:${tier}`;
  const found = isRecord(scripts) ? scripts[key] : undefined;
  const expected = `${TEST_ENTRY_POINT.bin} --tier=${tier}`;
  const hasTests = files.some((candidate) => candidate.startsWith(`tests/${tier}/`) && TEST_FILE.test(candidate));
  if (!hasTests && found === undefined) return undefined;
  if (found === expected) return undefined;
  return {
    file,
    line: undefined,
    message: `${key} must be "${expected}"${hasTests ? " when its test tier has files" : " when declared"}, found ${JSON.stringify(found ?? null)}`,
  };
}

export function scriptViolations(manifest: unknown, files: readonly string[] = []): readonly Violation[] {
  const file = "package.json";
  const scripts = isRecord(manifest) ? manifest["scripts"] : undefined;
  const test = isRecord(scripts) ? scripts["test"] : undefined;
  const lint = isRecord(scripts) ? scripts["lint"] : undefined;
  const violations: Violation[] = [];
  if (typeof test !== "string" || !TEST_SCRIPTS.includes(test)) {
    violations.push({
      file,
      line: undefined,
      message: `scripts.test must be exactly "${TEST_ENTRY_POINT.bin}", which runs bun test --randomize and judges its skips, found ${JSON.stringify(test ?? null)}`,
    });
  }
  if (typeof lint !== "string" || !runsLayoutCheck(lint)) {
    violations.push({
      file,
      line: undefined,
      message: `scripts.lint must run the layout check: add "${ENTRY_POINT.bin}"`,
    });
  }
  for (const tier of TEST_TIERS) {
    const violation = tierScriptViolation(scripts, files, tier);
    if (violation !== undefined) violations.push(violation);
  }
  return violations;
}

export function bunfigViolations(consumer: unknown, preset: unknown, vendors: boolean): readonly Violation[] {
  const file = "bunfig.toml";
  const copy = "bun has no bunfig extends, so copy node_modules/@avi2dg/checks/bunfig.toml";
  if (consumer === undefined) {
    return [{ file, line: undefined, message: `bunfig.toml is missing; ${copy}` }];
  }
  const presetTest = isRecord(preset) ? preset["test"] : undefined;
  if (!isRecord(presetTest)) {
    return [{ file, line: undefined, message: "the shipped bunfig preset has no [test] table" }];
  }
  const consumerTest = isRecord(consumer) ? consumer["test"] : undefined;
  const found = (key: string): unknown => (isRecord(consumerTest) ? consumerTest[key] : undefined);
  const drifted = (key: string, wanted: string, fix: string): Violation => ({
    file,
    line: undefined,
    message: `[test].${key} must be ${wanted}, found ${JSON.stringify(found(key) ?? null)}; ${fix}`,
  });
  const violations: Violation[] = [];
  for (const [key, value] of Object.entries(presetTest)) {
    if (key !== IGNORES_KEY && !Bun.deepEquals(found(key), value)) violations.push(drifted(key, JSON.stringify(value), copy));
  }
  const accepted = acceptedIgnores(vendors);
  if (!accepted.some((ignores) => Bun.deepEquals(found(IGNORES_KEY), ignores))) {
    const wanted = accepted.map((ignores) => JSON.stringify(ignores)).join(" or ");
    violations.push(drifted(IGNORES_KEY, wanted, `the check pins it, requiring ${VENDORED} where ${QUALITY_FILE} declares sources.libraries`));
  }
  return violations;
}

const workingTreeFiles = Effect.fn("workingTreeFiles")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const listed = yield* git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"], root);
  return yield* Effect.filter(listed.split("\0").filter(Boolean), (file) => fs.exists(path.join(root, file)), {
    concurrency: "unbounded",
  });
});

const parsedToml = Effect.fn("parsedToml")(function* (file: string) {
  const text = yield* (yield* FileSystem.FileSystem).readFileString(file);
  return yield* Effect.try({
    try: (): unknown => Bun.TOML.parse(text),
    catch: (error) => new LayoutError({ message: `cannot parse ${file}: ${String(error)}` }),
  });
});

const parseJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

const readManifest = Effect.fn("readManifest")(function* (file: string) {
  const text = yield* (yield* FileSystem.FileSystem).readFileString(file);
  return yield* parseJson(text).pipe(
    Effect.mapError((cause) => new LayoutError({ message: `cannot read ${file} as JSON: ${cause.message}` })),
  );
});

export type Result = { readonly files: number; readonly violations: readonly Violation[] };

export const run = Effect.fn("run")(function* (root: string, presetPath: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const files = yield* workingTreeFiles(root);
  const violations: Violation[] = [...placementViolations(files)];

  const inProcess = files.filter(
    (file) =>
      file.startsWith(TESTS) &&
      TYPESCRIPT.test(file) &&
      !startsWithAny(file, OUT_OF_PROCESS) &&
      !file.startsWith(DATA_DIR),
  );
  for (const file of inProcess) {
    const source = yield* fs.readFileString(path.join(root, file));
    violations.push(...(yield* isolationViolations(file, source)));
  }

  violations.push(...scriptViolations(yield* readManifest(path.join(root, "package.json")), files));

  const bunfig = path.join(root, "bunfig.toml");
  const consumerBunfig = (yield* fs.exists(bunfig)) ? yield* parsedToml(bunfig) : undefined;
  const { quality } = yield* readQuality(root);
  const vendors = (quality.sources?.libraries ?? []).length > 0;
  violations.push(...bunfigViolations(consumerBunfig, yield* parsedToml(presetPath), vendors));

  return { files: files.length, violations };
});

export function report({ files, violations }: Result): string {
  if (violations.length === 0) return `test-layout: ${files} files satisfy the layout`;
  const lines = violations.map(
    (violation) =>
      `  ${violation.file}${violation.line === undefined ? "" : `:${violation.line}`}: ${violation.message}`,
  );
  return [`test-layout: ${violations.length} violation(s)`, ...lines].join("\n");
}

const layout = Effect.gen(function* () {
  const path = yield* Path.Path;
  const root = process.argv[2] ?? process.cwd();
  const result = yield* run(root, path.join(import.meta.dir, "..", "bunfig.toml"));
  yield* Console.log(report(result));
  return result.violations.length === 0;
});

if (import.meta.main) runMain("test-layout", layout);
