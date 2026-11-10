import { TEST_ENTRY_POINT } from "./gates.ts";

export type TestTier = "live" | "pixel" | "unit" | "e2e";

export type TestOptions = {
  readonly tier?: TestTier;
  readonly workers?: number;
  readonly full?: boolean;
};

const FULL = "--full";
const TIERS = new Map<string, TestTier>([
  ["--tier=live", "live"],
  ["--tier=pixel", "pixel"],
  ["--tier=unit", "unit"],
  ["--tier=e2e", "e2e"],
]);
const PARALLEL = /^--parallel=([1-9][0-9]*)$/;

function optionOf(arg: string): TestOptions | undefined {
  const tier = TIERS.get(arg);
  if (tier !== undefined) return { tier };
  if (arg === FULL) return { full: true };
  const workers = PARALLEL.exec(arg)?.[1];
  return workers === undefined ? undefined : { workers: Number(workers) };
}

export function testOptions(args: readonly string[]): TestOptions | undefined {
  let options: TestOptions = {};
  for (const arg of args) {
    const option = optionOf(arg);
    if (option === undefined || Object.keys(option).some((key) => key in options)) return undefined;
    options = { ...options, ...option };
  }
  if (options.tier !== undefined && options.full === true) return undefined;
  return options;
}

const TEST_SCRIPTS: readonly string[] = [TEST_ENTRY_POINT.bin];

export const KIT_PACKAGE_NAME = "@avi2dg/checks";

const OWN_TEST_ENTRY = `bun src/${TEST_ENTRY_POINT.script}`;

export function ownTestScriptToBin(script: unknown): string | undefined {
  if (typeof script !== "string") return undefined;
  if (script === OWN_TEST_ENTRY || script.startsWith(`${OWN_TEST_ENTRY} `)) return `${TEST_ENTRY_POINT.bin}${script.slice(OWN_TEST_ENTRY.length)}`;
  return undefined;
}

export function kitScriptsToBin(scripts: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const next: Record<string, unknown> = { ...scripts };
  for (const [key, value] of Object.entries(next)) {
    if (key === "test" || key.startsWith("test:")) {
      const bin = ownTestScriptToBin(value);
      if (bin !== undefined) next[key] = bin;
    }
  }
  return next;
}

export function ownTierCommand(tier: TestTier): string {
  return `${OWN_TEST_ENTRY} --tier=${tier}`;
}

export function scriptOptions(script: unknown): TestOptions | undefined {
  if (typeof script !== "string") return undefined;
  const entry = TEST_SCRIPTS.find((candidate) => script === candidate || script.startsWith(`${candidate} `));
  return entry === undefined ? undefined : testOptions(script.slice(entry.length).split(" ").filter((arg) => arg !== ""));
}

export type StandardScript = { readonly kind: "test" } | { readonly kind: "fast" } | { readonly kind: "tier"; readonly tier: TestTier };

const CHANGED = "--changed";

export function standardScript(script: unknown): StandardScript | undefined {
  if (typeof script !== "string") return undefined;
  const entry = TEST_SCRIPTS.find((candidate) => script === candidate || script.startsWith(`${candidate} `));
  if (entry === undefined) return undefined;
  const args = script.slice(entry.length).split(" ").filter((arg) => arg !== "");
  if (args.length === 0) return { kind: "test" };
  if (args.length === 1 && args[0] === CHANGED) return { kind: "fast" };
  const options = testOptions(args);
  if (options?.tier !== undefined && options.workers === undefined && options.full !== true) return { kind: "tier", tier: options.tier };
  return undefined;
}

export type ScriptFault =
  | { readonly kind: "test" | "fast" | "tier"; readonly key: string; readonly expected: string; readonly found: string | undefined }
  | { readonly kind: "empty-tier" | "stray"; readonly key: string; readonly found: string };

const testFault = (scripts: Readonly<Record<string, unknown>>): ScriptFault | undefined => {
  const test = scripts["test"];
  if (typeof test === "string" && standardScript(test)?.kind === "test") return undefined;
  return { kind: "test", key: "test", expected: TEST_COMMAND, found: typeof test === "string" ? test : undefined };
};

const fastFault = (scripts: Readonly<Record<string, unknown>>): ScriptFault | undefined => {
  const fast = scripts["test:fast"];
  if (typeof fast === "string" && standardScript(fast)?.kind === "fast") return undefined;
  return { kind: "fast", key: "test:fast", expected: FAST_COMMAND, found: typeof fast === "string" ? fast : undefined };
};

const tierFault = (found: unknown, tier: TestTier, hasTests: boolean): ScriptFault | undefined => {
  const key = `test:${tier}`;
  if (!hasTests) {
    return typeof found === "string" ? { kind: "empty-tier", key, found } : undefined;
  }
  if (typeof found !== "string") {
    return { kind: "tier", key, expected: tierCommand(tier), found: undefined };
  }
  const parsed = standardScript(found);
  if (parsed?.kind === "tier" && parsed.tier === tier) return undefined;
  return { kind: "tier", key, expected: tierCommand(tier), found };
};

const strayFaults = (scripts: Readonly<Record<string, unknown>>): readonly ScriptFault[] => {
  const known = new Set(["test", "test:fast", ...STANDARD_TIERS.map((tier) => `test:${tier}`)]);
  const faults: ScriptFault[] = [];
  for (const [key, value] of Object.entries(scripts)) {
    if (typeof value === "string" && key.startsWith("test:") && !known.has(key)) faults.push({ kind: "stray", key, found: value });
  }
  return faults;
};

export function scriptFaults(
  scripts: Readonly<Record<string, unknown>>,
  hasTests: (tier: TestTier) => boolean,
): readonly ScriptFault[] {
  const faults: ScriptFault[] = [];
  for (const fault of [testFault(scripts), fastFault(scripts), ...STANDARD_TIERS.map((tier) => tierFault(scripts[`test:${tier}`], tier, hasTests(tier)))]) {
    if (fault !== undefined) faults.push(fault);
  }
  faults.push(...strayFaults(scripts));
  return faults;
}

export const TEST_FILE = /(?:[.](?:test|spec)|_test)[.](tsx?)$/;

export function hasTierTests(files: readonly string[], tier: TestTier): boolean {
  return files.some((file) => file.startsWith(`tests/${tier}/`) && TEST_FILE.test(file));
}

export const STANDARD_TIERS: readonly TestTier[] = ["unit", "e2e", "live", "pixel"];

export const TEST_COMMAND = TEST_ENTRY_POINT.bin;

export const FAST_COMMAND = `${TEST_ENTRY_POINT.bin} ${CHANGED}`;

export function tierCommand(tier: TestTier): string {
  return `${TEST_ENTRY_POINT.bin} --tier=${tier}`;
}
