import { $ } from "bun";
import { expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { CHECKOUT, fixtureRepos, lintWiring, type FixtureRepo } from "./lib/fixture-repo.ts";

const ROSE = "file(s) .jscpd.json holds repeat more lines than where the range starts, at 50 tokens and 5 lines:\n";
const open = fixtureRepos("checks-repetition-");
const JSCPD = JSON.stringify({ path: ["src"], ignore: ["**/*.d.ts"] });

// Ten lines and some 70 tokens, over jscpd's 50 and 5, and no two seeds share a token sequence that long.
function block(seed: string): string {
  return [
    `export function ${seed}Sum(${seed}Rows: readonly number[]): number {`,
    `  let ${seed}Total = 0;`,
    `  for (const ${seed}Row of ${seed}Rows) {`,
    `    if (${seed}Row > 10) ${seed}Total += ${seed}Row * 2;`,
    `    else if (${seed}Row < 0) ${seed}Total -= ${seed}Row;`,
    `    else ${seed}Total += 1;`,
    `    if (${seed}Total > 1000) return 1000;`,
    "  }",
    `  return ${seed}Total;`,
    "}",
    "",
  ].join("\n");
}

function lines(count: number, prefix: string): string {
  return Array.from({ length: count }, (_, index) => `export const ${prefix}${index} = ${index};\n`).join("");
}

function repository(files: Readonly<Record<string, string>>): Promise<FixtureRepo> {
  return open({ ".jscpd.json": JSCPD, ...files });
}

test(
  "without jscpd to run it cannot decide, and exits 2",
  async () => {
    const { dir, commit } = await repository({ "src/ledger.ts": block("ledger") });
    const first = await commit("feat: first");
    const gitOnly = { ...process.env, PATH: dirname(Bun.which("git") ?? "/usr/bin/git") };
    const result = await $`${process.execPath} ${join(CHECKOUT, "src", "complexity", "repetition.ts")} ${first}`.cwd(dir).env(gitOnly).nothrow().quiet();
    expect(result.stderr.toString()).toContain("repetition: cannot run jscpd");
    expect(result.exitCode).toBe(2);
  },
  60_000,
);

test(
  "the range runs from the merge base, or the empty tree, to the head commit, following a rename and ignoring the working tree",
  async () => {
    const { dir, write, commit, script } = await repository({ "src/ledger.ts": block("ledger"), "src/invoice.ts": block("ledger") });
    const first = await commit("feat: base");
    const rootRange = await script("complexity/repetition.ts", first);
    expect(rootRange.text).toContain(
      `repetition: 2 ${ROSE}  src/invoice.ts: 10 repeated line(s), up from 0\n    src/invoice.ts:1-10 repeats src/ledger.ts:1-10\n  src/ledger.ts: 10 repeated line(s), up from 0\n`,
    );
    expect(rootRange.exitCode).toBe(1);

    await $`git checkout -q -b feature && mkdir src/billing && git mv src/invoice.ts src/billing/invoice.ts`.cwd(dir).quiet();
    await write({ "src/billing/invoice.ts": `${block("ledger")}${lines(2, "moved")}`, "src/copy.ts": `${lines(10, "copy")}${block("ledger")}` });
    const head = await commit("feat: copy");
    await $`git checkout -q main`.cwd(dir).quiet();
    await write({ "src/invoice.ts": lines(2, "invoice") });
    await commit("refactor: drop the copy on main");
    await $`git checkout -q feature`.cwd(dir).quiet();
    await write({ "src/copy.ts": lines(2, "copy"), "src/other.ts": block("ledger") });

    const red = await script("complexity/repetition.ts", "main", head);
    expect(red.text).toContain(`repetition: 1 ${ROSE}  src/copy.ts: 10 repeated line(s), up from 0\n`);
    expect(red.text).not.toContain("other.ts");
    expect(red.exitCode).toBe(1);
  },
  60_000,
);

test(
  "checks-lint runs the repetition hold over its range, red on an added copy and green once it is gone",
  async () => {
    const { dir, write, commit, lint } = await repository({ ...lintWiring(), "src/ledger.ts": block("ledger") });
    await commit("feat: base");
    await $`git update-ref refs/remotes/origin/main HEAD && git checkout -q -b feature`.cwd(dir).quiet();
    await write({ "src/copy.ts": block("ledger") });
    await commit("feat: copy");

    const red = await lint();
    expect(red.text).toContain("  src/copy.ts: 10 repeated line(s), up from 0\n");
    expect(red.text).toContain("checks-lint: 1 of 11 gate(s) failed: checks-repetition\n");
    expect(red.exitCode).toBe(1);

    await write({ "src/copy.ts": "export const copy = 1;\n" });
    await commit("fix: no copy");
    const green = await lint();
    expect(green.text).toContain("checks-lint: 11 gate(s) pass\n");
    expect(green.exitCode).toBe(0);
  },
  60_000,
);

test(
  "the path and ignore keys of the head's .jscpd.json decide which files the hold measures",
  async () => {
    const { write, commit, script } = await repository({ "src/ledger.ts": block("ledger") });
    const base = await commit("feat: base");
    await write({ "src/copy.ts": block("ledger"), "tools/copy.ts": block("ledger") });
    const head = await commit("feat: copies");
    const red = await script("complexity/repetition.ts", base, head);
    expect(red.text).toContain(`repetition: 2 ${ROSE}  src/copy.ts: 10 repeated line(s), up from 0\n`);
    expect(red.text).not.toContain("tools/copy.ts");
    expect(red.exitCode).toBe(1);

    await write({ ".jscpd.json": JSON.stringify({ path: ["src"], ignore: ["**/copy.ts"] }) });
    const ignored = await commit("chore: ignore the copy");
    const green = await script("complexity/repetition.ts", base, ignored);
    expect(green.text).toContain("repetition: 1 file(s) .jscpd.json holds repeat no more lines than where the range starts");
    expect(green.exitCode).toBe(0);
  },
  60_000,
);

test(
  "a threshold in .jscpd.json the tree already crosses leaves the hold to judge the range",
  async () => {
    const { write, commit, script } = await repository({
      ".jscpd.json": JSON.stringify({ path: ["src"], threshold: 1 }),
      "src/ledger.ts": block("ledger"),
      "src/invoice.ts": block("ledger"),
    });
    const base = await commit("feat: base over the threshold");
    await write({ "src/small.ts": lines(2, "small") });
    const kept = await commit("feat: no new copy");
    const green = await script("complexity/repetition.ts", base, kept);
    expect(green.text).toContain("repeat no more lines than where the range starts");
    expect(green.exitCode).toBe(0);

    await write({ "src/copy.ts": block("ledger") });
    const copied = await commit("feat: another copy");
    const red = await script("complexity/repetition.ts", base, copied);
    expect(red.text).toContain("  src/copy.ts: 10 repeated line(s), up from 0\n");
    expect(red.exitCode).toBe(1);
  },
  60_000,
);

test(
  "a path the head's .jscpd.json names that the base lacks reads as empty at the base",
  async () => {
    const { write, commit, script } = await repository({ "src/ledger.ts": block("ledger") });
    const base = await commit("feat: base");
    await write({ ".jscpd.json": JSON.stringify({ path: ["src", "tools"] }), "tools/copy.ts": block("ledger") });
    const head = await commit("feat: a measured folder");
    const red = await script("complexity/repetition.ts", base, head);
    expect(red.text).toContain(`repetition: 2 ${ROSE}  src/ledger.ts: 10 repeated line(s), up from 0\n`);
    expect(red.text).toContain("  tools/copy.ts: 10 repeated line(s), up from 0\n");
    expect(red.exitCode).toBe(1);
  },
  60_000,
);
