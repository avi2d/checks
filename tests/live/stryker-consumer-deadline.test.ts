import { $ } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ran, UNVENDORED_BUNFIG } from "../e2e/lib/fixture-repo.ts";
import { expectStrykerExitsZero, removeConsumer, STRYKER_CONFIG, unpackConsumer } from "../e2e/lib/stryker-consumer.ts";

let packDir = "";
let dir = "";

beforeAll(async () => {
  const consumer = await unpackConsumer();
  packDir = consumer.packDir;
  dir = consumer.dir;
  await writeFile(join(dir, "bunfig.toml"), UNVENDORED_BUNFIG);
  await writeFile(join(dir, "stryker.conf.mjs"), STRYKER_CONFIG);
  await writeFile(join(dir, "widget.ts"), "export const widget = (a: number): number => a + 2;\n");
}, 360_000);

afterAll(async () => {
  await removeConsumer([dir, packDir]);
}, 60_000);

const unitSuite = async (files: Readonly<Record<string, string>>): Promise<void> => {
  await rm(join(dir, "tests", "unit"), { recursive: true, force: true });
  await mkdir(join(dir, "tests", "unit"), { recursive: true });
  for (const [name, text] of Object.entries(files)) await writeFile(join(dir, "tests", "unit", name), text);
};

const sleepingFile = (file: number): string =>
  [
    'import { expect, test } from "bun:test";',
    'import { widget } from "../../widget.ts";',
    ...[0, 1, 2, 3, 4].map((one) => `test("sleeps ${file}-${one}", async () => { await Bun.sleep(2000); expect(widget(40)).toBe(42); });`),
    "",
  ].join("\n");

test(
  "a healthy 100 second unit suite of 2 second tests passes the dry run instead of being killed at 90 seconds",
  async () => {
    await unitSuite(Object.fromEntries([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((file) => [`s${file}.test.ts`, sleepingFile(file)])));

    const result = await ran($`bunx stryker run --mutate widget.ts --ignoreStatic --dryRunOnly --reporters clear-text`.cwd(dir));

    expectStrykerExitsZero(result);
    expect(result.text).toMatch(/Initial test run succeeded\. Ran 50 tests/);
  },
  300_000,
);

test(
  "a test that never settles fails the dry run at bun's 5 second per-test limit instead of running on to a whole-run deadline",
  async () => {
    await unitSuite({
      "hangs.test.ts": 'import { test } from "bun:test";\n\ntest("hangs", async () => {\n  await new Promise(() => {});\n});\n',
    });

    const started = Date.now();
    const result = await ran($`bunx stryker run --mutate widget.ts --ignoreStatic --dryRunOnly --reporters clear-text`.cwd(dir));

    expect(result.exitCode).not.toBe(0);
    expect(result.text).toContain("timed out after 5000ms");
    expect(Date.now() - started).toBeLessThan(60_000);
  },
  120_000,
);
