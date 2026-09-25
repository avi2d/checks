import { $ } from "bun";
import { expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CHECKOUT, fixtureRepos, lintWiring, type FixtureRepo } from "./lib/fixture-repo.ts";

const QUALITY = { sources: { production: ["src/**/*.ts"] } };
const MEASURE = "at 50 tokens and 5 lines";
const HELD = `production file(s) repeat no more lines than where the range starts, ${MEASURE}\n`;
const ROSE = `production file(s) repeat more lines than where the range starts, ${MEASURE}:\n`;

const open = fixtureRepos("checks-repetition-");

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

function repository(files: Readonly<Record<string, string>>, quality: unknown = QUALITY): Promise<FixtureRepo> {
  return open({ "quality.json": JSON.stringify(quality), ...files });
}

test(
  "red on a change that adds a repeated block to production, green once it is gone; tests stay advisory",
  async () => {
    const { write, commit, script } = await repository({
      "src/ledger.ts": `${lines(3, "rate")}${block("ledger")}`,
      "src/small.ts": lines(2, "small"),
    });
    const base = await commit("feat: base");
    await write({
      "src/fresh.ts": `${block("ledger")}${lines(2, "fresh")}`,
      "tests/one.test.ts": block("fixture"),
      "tests/two.test.ts": block("fixture"),
      "tests/copy.test.ts": block("ledger"),
    });
    const head = await commit("feat: fresh");

    const red = await script("repetition.ts", base, head);
    expect(red.text).toContain(
      `repetition: 2 ${ROSE}` +
        "  src/fresh.ts: 10 repeated line(s), up from 0\n" +
        "    src/fresh.ts:1-10 repeats src/ledger.ts:4-13\n" +
        "  src/ledger.ts: 10 repeated line(s), up from 0\n" +
        "    src/ledger.ts:4-13 repeats src/fresh.ts:1-10\n",
    );
    expect(red.text).toContain(
      "repetition: advisory, 2 file(s) repeat lines the hold does not fail:\n" +
        "  tests/one.test.ts: 10 repeated line(s)\n" +
        "  tests/two.test.ts: 10 repeated line(s)\n",
    );
    expect(red.text).not.toContain("small.ts");
    expect(red.text).not.toContain("copy.test.ts");
    expect(red.exitCode).toBe(1);

    await write({ "src/fresh.ts": lines(4, "fresh") });
    const green = await script("repetition.ts", base, await commit("fix: no copy"));
    expect(green.text).toContain(`repetition: 3 ${HELD}`);
    expect(green.exitCode).toBe(0);
  },
  60_000,
);

test(
  "a change that keeps or removes existing repetition passes and lists it as advisory, while a third copy fails",
  async () => {
    const audit = `${block("audit")}${lines(2, "gap")}${block("audit")}`;
    const { write, commit, script } = await repository({
      "src/ledger.ts": block("ledger"),
      "src/invoice.ts": block("ledger"),
      "src/audit.ts": audit,
    });
    const base = await commit("feat: base");

    await write({ "src/ledger.ts": `${lines(3, "kept")}${block("ledger")}` });
    const kept = await script("repetition.ts", base, await commit("feat: touch the copy"));
    expect(kept.text).toContain(`repetition: 3 ${HELD}`);
    expect(kept.text).toContain(
      "repetition: advisory, 3 file(s) repeat lines the hold does not fail:\n" +
        "  src/audit.ts: 20 repeated line(s)\n" +
        "  src/invoice.ts: 10 repeated line(s)\n" +
        "  src/ledger.ts: 10 repeated line(s)\n",
    );
    expect(kept.exitCode).toBe(0);

    await write({ "src/invoice.ts": lines(2, "invoice"), "src/audit.ts": block("audit") });
    const removed = await script("repetition.ts", base, await commit("refactor: drop the copies"));
    expect(removed.text).toContain(`repetition: 3 ${HELD}`);
    expect(removed.text).not.toContain("advisory");
    expect(removed.exitCode).toBe(0);

    await write({ "src/invoice.ts": block("ledger"), "src/audit.ts": audit, "src/third.ts": block("ledger") });
    const third = await script("repetition.ts", base, await commit("feat: a third copy"));
    expect(third.text).toContain(`repetition: 1 ${ROSE}  src/third.ts: 10 repeated line(s), up from 0\n`);
    expect(third.text).toContain("  src/audit.ts: 20 repeated line(s)\n");
    expect(third.exitCode).toBe(1);
  },
  60_000,
);

test(
  "a renamed file is measured against its old path, so moving existing repetition passes",
  async () => {
    const { dir, commit, script } = await repository({ "src/ledger.ts": block("ledger"), "src/invoice.ts": block("ledger") });
    const base = await commit("feat: base");
    await mkdir(join(dir, "src/billing"));
    await $`git mv src/ledger.ts src/billing/ledger.ts && git mv src/invoice.ts src/billing/invoice.ts`.cwd(dir).quiet();
    await writeFile(join(dir, "src/billing/invoice.ts"), `${block("ledger")}${lines(2, "moved")}`);

    const moved = await script("repetition.ts", base, await commit("refactor: move"));
    expect(moved.text).toContain(`repetition: 2 ${HELD}`);
    expect(moved.text).toContain("  src/billing/invoice.ts: 10 repeated line(s)\n  src/billing/ledger.ts: 10 repeated line(s)\n");
    expect(moved.exitCode).toBe(0);
  },
  60_000,
);

test(
  "the range starts at the merge base, so repetition only the base branch added is not held against the head",
  async () => {
    const { dir, write, commit, script } = await repository({ "src/ledger.ts": block("ledger") });
    await commit("feat: base");
    await $`git checkout -q -b feature`.cwd(dir).quiet();
    await write({ "src/feature.ts": lines(2, "feature") });
    const head = await commit("feat: feature");
    await $`git checkout -q main`.cwd(dir).quiet();
    await write({ "src/copy.ts": block("ledger") });
    await commit("feat: copy on main");

    const result = await script("repetition.ts", "main", head);
    expect(result.text).toContain(`repetition: 2 ${HELD}`);
    expect(result.exitCode).toBe(0);
  },
  60_000,
);

test(
  "it measures the head commit, so an uncommitted edit neither fails nor passes the range",
  async () => {
    const { write, commit, script } = await repository({ "src/ledger.ts": block("ledger") });
    const base = await commit("feat: base");
    await write({ "src/copy.ts": block("ledger") });
    const head = await commit("feat: copy");

    await write({ "src/copy.ts": lines(2, "copy"), "src/other.ts": block("ledger") });
    const committed = await script("repetition.ts", base, head);
    expect(committed.text).toContain("  src/copy.ts: 10 repeated line(s), up from 0\n");
    expect(committed.text).not.toContain("other.ts");
    expect(committed.exitCode).toBe(1);
  },
  60_000,
);

test(
  "a first commit is judged against the empty tree, and a repository declaring no production sources passes saying so",
  async () => {
    const { write, commit, script } = await repository({ "src/ledger.ts": block("ledger"), "src/copy.ts": block("ledger") });
    const first = await commit("feat: first");
    const red = await script("repetition.ts", first);
    expect(red.text).toContain("  src/copy.ts: 10 repeated line(s), up from 0\n");
    expect(red.exitCode).toBe(1);

    await write({ "quality.json": JSON.stringify({}) });
    const undeclared = await script("repetition.ts", first);
    expect(undeclared.text).toBe("repetition: quality.json declares no sources.production\n");
    expect(undeclared.exitCode).toBe(0);
  },
  60_000,
);

test(
  "without jscpd to run it cannot decide, and exits 2",
  async () => {
    const { dir, commit } = await repository({ "src/ledger.ts": block("ledger") });
    const first = await commit("feat: first");
    const gitOnly = { ...process.env, PATH: dirname(Bun.which("git") ?? "/usr/bin/git") };
    const result = await $`${process.execPath} ${join(CHECKOUT, "scripts", "repetition.ts")} ${first}`.cwd(dir).env(gitOnly).nothrow().quiet();
    expect(result.stderr.toString()).toContain("repetition: cannot run jscpd");
    expect(result.exitCode).toBe(2);
  },
  60_000,
);

test(
  "checks-lint runs the repetition hold over its range, red on an added copy and green once it is gone",
  async () => {
    const { dir, write, commit, lint } = await repository({ ...(await lintWiring(QUALITY)), "src/ledger.ts": block("ledger") });
    await commit("feat: base");
    await $`git update-ref refs/remotes/origin/main HEAD && git checkout -q -b feature`.cwd(dir).quiet();
    await write({ "src/copy.ts": block("ledger") });
    await commit("feat: copy");

    const red = await lint();
    expect(red.text).toContain("  src/copy.ts: 10 repeated line(s), up from 0\n");
    expect(red.text).toContain("checks-lint: 1 of 12 gate(s) failed: checks-repetition\n");
    expect(red.exitCode).toBe(1);

    await write({ "src/copy.ts": lines(2, "copy") });
    await commit("fix: no copy");
    const green = await lint();
    expect(green.text).toContain("checks-lint: 12 gate(s) pass\n");
    expect(green.exitCode).toBe(0);
  },
  60_000,
);
