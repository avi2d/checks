#!/usr/bin/env bun
import { parse } from "@swc/core";
import { Console, Effect, FileSystem, Path, Schema } from "effect";
import { git } from "./git.ts";
import { runMain } from "./main.ts";
import { ENTRY_POINT, TEST_ENTRY_POINT } from "./gates.ts";

export type Violation = {
  readonly file: string;
  readonly line: number | undefined;
  readonly message: string;
};

const TESTS = "tests/";
const E2E = "tests/e2e/";
const HELPER_DIRS = ["tests/lib/", "tests/fixtures/"] as const;
const DATA_DIR = "tests/fixtures/";

const TEST_FILE = /(?:[.](?:test|spec)|_test)[.](tsx?)$/;
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

const REQUIRED_TEST_TABLE: Record<string, unknown> = {
  pathIgnorePatterns: ["**/tests/quarantine/**", "repos/**"],
};
export const LAYOUT_CHECK_MARK = "scripts/test-layout.ts";
export const LAYOUT_CHECK_BIN = "checks-test-layout";
const OWN_ENTRY_POINT = `scripts/${ENTRY_POINT.script}`;
const TEST_SCRIPTS: readonly string[] = [TEST_ENTRY_POINT.bin, `bun scripts/${TEST_ENTRY_POINT.script}`];

export class LayoutError extends Schema.TaggedError<LayoutError>()("LayoutError", {
  message: Schema.String,
}) {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

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

function lineOf(source: string, start: number): number {
  const bytes = Buffer.from(source, "utf8");
  const offset = Math.max(0, Math.min(bytes.length, start - 1));
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (bytes[index] === 0x0a) line += 1;
  }
  return line;
}

function bannedModule(specifier: string): string | undefined {
  const bare = specifier.startsWith("node:") ? specifier.slice("node:".length) : specifier;
  return BANNED_MODULES.includes(bare) ? bare : undefined;
}

function identifierName(node: unknown): string | undefined {
  if (!isRecord(node) || node["type"] !== "Identifier") return undefined;
  const value = node["value"];
  return typeof value === "string" ? value : undefined;
}

function stringValue(node: unknown): string | undefined {
  if (!isRecord(node) || node["type"] !== "StringLiteral") return undefined;
  const value = node["value"];
  return typeof value === "string" ? value : undefined;
}

function spanStart(node: Record<string, unknown>): number {
  const span = node["span"];
  if (!isRecord(span)) return 0;
  const start = span["start"];
  return typeof start === "number" ? start : 0;
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
  const module = yield* Effect.tryPromise({
    try: () => parse(source, { syntax: "typescript", tsx: file.endsWith(".tsx"), target: "esnext" }),
    catch: (error) => new LayoutError({ message: `cannot parse ${file}: ${String(error)}` }),
  });
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

export function scriptViolations(manifest: unknown): readonly Violation[] {
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
  return violations;
}

export function bunfigViolations(consumer: unknown, preset: unknown): readonly Violation[] {
  const file = "bunfig.toml";
  const copy = "bun has no bunfig extends, so copy node_modules/@avi2dg/checks/bunfig.toml";
  if (consumer === undefined) {
    return [{ file, line: undefined, message: `bunfig.toml is missing; ${copy}` }];
  }
  const presetTest = isRecord(preset) ? preset["test"] : undefined;
  if (!isRecord(presetTest)) {
    return [{ file, line: undefined, message: "the shipped bunfig preset has no [test] table" }];
  }
  const expected = { ...presetTest, ...REQUIRED_TEST_TABLE };
  const consumerTest = isRecord(consumer) ? consumer["test"] : undefined;
  const violations: Violation[] = [];
  for (const [key, value] of Object.entries(expected)) {
    const found = isRecord(consumerTest) ? consumerTest[key] : undefined;
    if (!Bun.deepEquals(found, value)) {
      violations.push({
        file,
        line: undefined,
        message: `[test].${key} must be ${JSON.stringify(value)}, found ${JSON.stringify(found ?? null)}; ${copy}`,
      });
    }
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
      !file.startsWith(E2E) &&
      !file.startsWith(DATA_DIR),
  );
  for (const file of inProcess) {
    const source = yield* fs.readFileString(path.join(root, file));
    violations.push(...(yield* isolationViolations(file, source)));
  }

  violations.push(...scriptViolations(yield* readManifest(path.join(root, "package.json"))));

  const bunfig = path.join(root, "bunfig.toml");
  const consumerBunfig = (yield* fs.exists(bunfig)) ? yield* parsedToml(bunfig) : undefined;
  violations.push(...bunfigViolations(consumerBunfig, yield* parsedToml(presetPath)));

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
