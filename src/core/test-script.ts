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

const TEST_SCRIPTS: readonly string[] = [TEST_ENTRY_POINT.bin, `bun src/${TEST_ENTRY_POINT.script}`];

export function scriptOptions(script: unknown): TestOptions | undefined {
  if (typeof script !== "string") return undefined;
  const entry = TEST_SCRIPTS.find((candidate) => script === candidate || script.startsWith(`${candidate} `));
  return entry === undefined ? undefined : testOptions(script.slice(entry.length).split(" ").filter((arg) => arg !== ""));
}
