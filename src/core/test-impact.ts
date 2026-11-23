import { TEST_TREE } from "./imports.ts";
import { classifyPath } from "./scope.ts";

export const TEST_FIXTURES = "tests/fixtures/";
export const TEST_FILE = /\.test\.tsx?$/;

const LOCKFILES = new Set(["bun.lock", "bun.lockb", "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml"]);
const TOOL_PINS = new Set([".bun-version", ".npmrc", ".nvmrc", ".node-version", ".tool-versions"]);
const CONFIG = /(?:^|\.)config\.(?:[cm]?[jt]s|json)$/;

export const basenameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

export function testEnvironmentReason(path: string): string | undefined {
  if (path.startsWith(TEST_FIXTURES)) return undefined;
  const name = basenameOf(path);
  if (LOCKFILES.has(name)) return "a lockfile";
  if (path.startsWith(".github/workflows/") || path.startsWith(".github/actions/")) return "CI wiring";
  if ((classifyPath(path) === "workflow" && !path.startsWith(".github/")) || CONFIG.test(name) || TOOL_PINS.has(name)) return "a config every test runs under";
  if (path.startsWith(TEST_TREE) && !TEST_FILE.test(path)) return "a test helper";
  return undefined;
}

export function pullRequestReason(path: string, reason: string): string {
  return `the pull request changes ${path}, ${reason}`;
}
