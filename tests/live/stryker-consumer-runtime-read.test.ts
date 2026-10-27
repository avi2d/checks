import { $ } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ran, UNVENDORED_BUNFIG } from "../e2e/lib/fixture-repo.ts";
import { committedBase, readReport, readState, removeConsumer, restoredFull, reusedOf, STRYKER_CONFIG, unpackConsumer } from "../e2e/lib/stryker-consumer.ts";

let packDir = "";
let dir = "";

beforeAll(async () => {
  const consumer = await unpackConsumer();
  packDir = consumer.packDir;
  dir = consumer.dir;
}, 360_000);

afterAll(async () => {
  await removeConsumer([dir, packDir]);
}, 60_000);

const DAY_MS = 86_400_000;

const OUTLINE = `export const anchorOf = (heading: string): string => heading.toLowerCase().replaceAll(" ", "-");
`;

const PAGES_TEST = `import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { anchorOf } from "../../outline.ts";

test("every anchor the page links names one of its headings", () => {
  const page = readFileSync(resolve(import.meta.dir, "..", "..", "docs", "page.md"), "utf8");
  const anchors = page.split("\\n").filter((line) => line.startsWith("## ")).map((line) => anchorOf(line.slice(3)));
  for (const [, link] of page.matchAll(/\\]\\(#([^)]+)\\)/g)) expect(anchors).toContain(link);
});
`;

const LINKED_PAGE = "# Page\n\nSee [the steps](#the-steps).\n\n## The steps\n";
const UNLINKED_PAGE = "# Page\n\n## The steps\n";

// The page is the oracle: with its one link gone the test's loop asserts nothing, so no mutant of anchorOf can be killed.
test(
  "a full state restored from before the refresh window reruns the mutants a test reaches through a markdown page it reads at runtime",
  async () => {
    await writeFile(join(dir, "bunfig.toml"), UNVENDORED_BUNFIG);
    await writeFile(join(dir, "stryker.conf.mjs"), STRYKER_CONFIG);
    await writeFile(join(dir, "outline.ts"), OUTLINE);
    await mkdir(join(dir, "docs"), { recursive: true });
    await writeFile(join(dir, "docs", "page.md"), LINKED_PAGE);
    await mkdir(join(dir, "tests", "unit"), { recursive: true });
    await writeFile(join(dir, "tests", "unit", "pages.test.ts"), PAGES_TEST);
    const sha = await committedBase(dir, ["bunfig.toml", "stryker.conf.mjs", "package.json", "outline.ts", "docs/page.md", "tests/unit/pages.test.ts"]);
    const ci = { ...process.env, CI: "true" };

    const full = await ran($`bunx stryker run --incremental --reporters json --mutate outline.ts`.cwd(dir).env(ci));
    expect(full.exitCode).toBe(0);
    const report = await Bun.file(join(dir, "reports", "mutation", "mutation.json")).text();
    const state = await Bun.file(join(dir, "reports", "stryker-incremental.json")).text();
    const linked = readState(state).files["outline.ts"]?.mutants ?? [];
    expect(linked.length).toBeGreaterThan(0);
    expect(linked.filter((mutant) => mutant.status !== "Killed")).toEqual([]);

    await writeFile(join(dir, "docs", "page.md"), UNLINKED_PAGE);
    await $`git add docs/page.md && git -c user.email=fixture@example.com -c user.name=Fixture commit -qm unlink`.cwd(dir).quiet();
    await rm(join(dir, "reports"), { recursive: true, force: true });
    await restoredFull(dir, report, state, sha, new Date(Date.now() - 29 * DAY_MS).toISOString());

    const rerun = await ran($`bunx stryker run --incremental --reporters json --mutate outline.ts`.cwd(dir).env(ci));
    expect(rerun.exitCode).toBe(0);
    expect(reusedOf(rerun.text)).toBeUndefined();
    const unlinked = (await readReport(join(dir, "reports", "mutation", "mutation.json"))).files["outline.ts"]?.mutants ?? [];
    expect(unlinked.length).toBe(linked.length);
    expect(unlinked.filter((mutant) => mutant.status !== "Survived")).toEqual([]);
  },
  480_000,
);
