import { Console, Effect } from "effect";
import { TEST_ENTRY_POINT } from "../core/gates.ts";
import { Usage } from "../core/main.ts";
import { decodeSetting, SETTINGS_FILE, TestFileSkips } from "../core/settings.ts";
import type { TestTier } from "../core/test-script.ts";
import { readDeclarationsIn, readSmokeFiles, scanTestFiles, selectedTierFile } from "./test-skips.ts";

export type SuiteSelection =
  | { readonly kind: "full" }
  | { readonly kind: "tier"; readonly tier: TestTier }
  | { readonly kind: "smoke" }
  | { readonly kind: "files"; readonly files: readonly string[] }
  | { readonly kind: "changed"; readonly files: readonly string[] };

const SKIP_KEY = "testFileSkips";

export const readTestFileSkips = Effect.fn("readTestFileSkips")(function* (root: string, configured: unknown) {
  const entries = configured === undefined ? [] : yield* decodeSetting(SKIP_KEY, TestFileSkips, configured);
  const excluded = new Set(entries);
  if (excluded.size === 0) return excluded;

  const known = new Set(yield* scanTestFiles(root));
  const missing = entries.filter((file) => !known.has(file));
  if (missing.length > 0) {
    return yield* new Usage({ message: `${SETTINGS_FILE} ${SKIP_KEY} names no test file at ${missing.join(", ")}` });
  }
  for (const file of entries) yield* Console.log(`${TEST_ENTRY_POINT.bin}: ${SKIP_KEY} excludes ${file}`);
  return excluded;
});

function tierUnignoreArgs(selection: SuiteSelection): readonly string[] {
  if (selection.kind === "tier" && (selection.tier === "live" || selection.tier === "pixel")) {
    return ["--path-ignore-patterns", ""];
  }
  return [];
}

function fileArgs(files: readonly string[]): readonly string[] {
  return files.map((file) => `./${file}`);
}

export function suiteArgs(selection: SuiteSelection, smoke: readonly string[]): readonly string[] {
  if (selection.kind === "tier") return [...tierUnignoreArgs(selection), `./tests/${selection.tier}`];
  if (selection.kind === "smoke") return ["./tests/unit", ...fileArgs(smoke)];
  if (selection.kind === "files" || selection.kind === "changed") return fileArgs(selection.files);
  return [];
}

const suiteFiles = Effect.fn("suiteFiles")(function* (root: string, selection: SuiteSelection, smoke: readonly string[]) {
  if (selection.kind === "files" || selection.kind === "changed") return selection.files;
  if (selection.kind === "smoke") return yield* readSmokeFiles(root, smoke);
  const tier = selection.kind === "tier" ? selection.tier : undefined;
  return (yield* scanTestFiles(root)).filter((file) => selectedTierFile(file, tier));
});

export const readSuiteScope = Effect.fn("readSuiteScope")(function* (
  root: string,
  selection: SuiteSelection,
  smoke: readonly string[],
  excluded: ReadonlySet<string>,
) {
  const selected = yield* suiteFiles(root, selection, smoke);
  const files = selected.filter((file) => !excluded.has(file));
  if (files.length === 0 && selected.length > 0) {
    return { kind: "empty", message: "all selected test files are excluded, so no test ran" } as const;
  }
  if (files.length === 0 && selection.kind === "tier") return { kind: "empty", message: `the ${selection.tier} tier has no test files` } as const;
  if (files.length === 0 && selection.kind === "smoke") {
    const message = `no unit test and no smoke list, so this local run ran nothing; declare the smoke key of ${SETTINGS_FILE}`;
    return { kind: "empty", message } as const;
  }
  const args = files.length === selected.length ? suiteArgs(selection, smoke) : [...tierUnignoreArgs(selection), ...fileArgs(files)];
  const declarations = yield* readDeclarationsIn(root, files);
  return { kind: "run", args, declarations } as const;
});
