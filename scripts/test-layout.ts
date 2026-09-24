#!/usr/bin/env bun
import { parseSync } from "@swc/core";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ENTRY_POINT } from "./gates.ts";

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

export const REQUIRED_TEST_SCRIPT = "bun test --randomize";
const REQUIRED_TEST_TABLE: Record<string, unknown> = {
  pathIgnorePatterns: ["**/tests/quarantine/**"],
};
export const LAYOUT_CHECK_MARK = "scripts/test-layout.ts";
export const LAYOUT_CHECK_BIN = "checks-test-layout";
const OWN_ENTRY_POINT = `scripts/${ENTRY_POINT.script}`;

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

function outOfProcessUse(node: Record<string, unknown>): string | undefined {
  const type = node["type"];

  if (type === "ImportDeclaration" || type === "ExportNamedDeclaration" || type === "ExportAllDeclaration") {
    const source = stringValue(node["source"]);
    if (source === undefined) return undefined;
    const banned = bannedModule(source);
    if (banned !== undefined) return `imports node:${banned}`;
    if (source === "bun") {
      const name = importedNames(node).find((candidate) => BANNED_BUN_NAMES.includes(candidate));
      if (name !== undefined) return `imports ${name} from bun`;
    }
    return undefined;
  }

  if (type === "MemberExpression") {
    if (identifierName(node["object"]) !== "Bun") return undefined;
    const property = identifierName(node["property"]);
    if (property !== undefined && BANNED_BUN_NAMES.includes(property)) return `uses Bun.${property}`;
    return undefined;
  }

  if (type === "CallExpression") {
    const callee = node["callee"];
    const calleeName = identifierName(callee);
    if (calleeName !== undefined && BANNED_GLOBAL_CALLS.includes(calleeName)) {
      return `calls ${calleeName}`;
    }
    const argument = Array.isArray(node["arguments"]) ? node["arguments"][0] : undefined;
    const specifier = isRecord(argument) ? stringValue(argument["expression"]) : undefined;
    if (specifier === undefined) return undefined;
    const banned = bannedModule(specifier);
    if (banned === undefined) return undefined;
    if (isRecord(callee) && callee["type"] === "Import") return `imports node:${banned}`;
    if (calleeName === "require") return `requires node:${banned}`;
    return undefined;
  }

  return undefined;
}

export function isolationViolations(file: string, source: string): readonly Violation[] {
  const module = parseSync(source, { syntax: "typescript", tsx: file.endsWith(".tsx"), target: "esnext" });
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
}

export function scriptViolations(manifest: unknown): readonly Violation[] {
  const file = "package.json";
  const scripts = isRecord(manifest) ? manifest["scripts"] : undefined;
  const test = isRecord(scripts) ? scripts["test"] : undefined;
  const lint = isRecord(scripts) ? scripts["lint"] : undefined;
  const violations: Violation[] = [];
  if (test !== REQUIRED_TEST_SCRIPT) {
    violations.push({
      file,
      line: undefined,
      message: `scripts.test must be exactly "${REQUIRED_TEST_SCRIPT}", found ${JSON.stringify(test ?? null)}`,
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

async function workingTreeFiles(root: string): Promise<readonly string[]> {
  const listed = Bun.spawnSync(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root });
  if (listed.exitCode !== 0) {
    throw new Error(`test-layout: git ls-files failed in ${root}: ${listed.stderr.toString()}`);
  }
  const listedFiles = listed.stdout.toString().split("\0").filter(Boolean);
  const present = await Promise.all(listedFiles.map((file) => Bun.file(join(root, file)).exists()));
  return listedFiles.filter((_, index) => present[index]);
}

async function parsedToml(path: string): Promise<unknown> {
  const imported: unknown = await import(path);
  return isRecord(imported) ? (imported["default"] ?? imported) : imported;
}

async function readManifest(root: string): Promise<unknown> {
  const text = await readFile(join(root, "package.json"), "utf8");
  return JSON.parse(text) as unknown;
}

export type Result = { readonly files: number; readonly violations: readonly Violation[] };

export async function run(root: string, presetPath: string): Promise<Result> {
  const files = await workingTreeFiles(root);
  const violations: Violation[] = [...placementViolations(files)];

  const inProcess = files.filter(
    (file) =>
      file.startsWith(TESTS) &&
      TYPESCRIPT.test(file) &&
      !file.startsWith(E2E) &&
      !file.startsWith(DATA_DIR),
  );
  for (const file of inProcess) {
    const source = await readFile(join(root, file), "utf8");
    violations.push(...isolationViolations(file, source));
  }

  violations.push(...scriptViolations(await readManifest(root)));

  const consumerBunfig = (await Bun.file(join(root, "bunfig.toml")).exists())
    ? await parsedToml(join(root, "bunfig.toml"))
    : undefined;
  violations.push(...bunfigViolations(consumerBunfig, await parsedToml(presetPath)));

  return { files: files.length, violations };
}

export function report({ files, violations }: Result): string {
  if (violations.length === 0) return `test-layout: ${files} files satisfy the layout`;
  const lines = violations.map(
    (violation) =>
      `  ${violation.file}${violation.line === undefined ? "" : `:${violation.line}`}: ${violation.message}`,
  );
  return [`test-layout: ${violations.length} violation(s)`, ...lines].join("\n");
}

if (import.meta.main) {
  const root = process.argv[2] ?? process.cwd();
  const preset = fileURLToPath(new URL("../bunfig.toml", import.meta.url));
  const result = await run(root, preset);
  console.log(report(result));
  process.exit(result.violations.length === 0 ? 0 : 1);
}
