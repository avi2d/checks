import { $ } from "bun";
import { expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { CHECKOUT, fixtureRepos, lintWiring, type FixtureRepo } from "./lib/fixture-repo.ts";

const BUDGET = "size-budget.ts";
const SCRIPT = join(CHECKOUT, "scripts", BUDGET);
const SIZE = { applies: "ratchet", production: { fileLines: 20, functionLines: 5 } };
const open = fixtureRepos("checks-size-budget-");
const guardrails = fixtureRepos("checks-lint-guardrails-");

function constants(count: number, prefix = "value"): string {
  return Array.from({ length: count }, (_, index) => `export const ${prefix}${index} = ${index};\n`).join("");
}

function counter(bodyLines: number): string {
  const body = Array.from({ length: bodyLines }, () => "  total += 1;\n").join("");
  return `export function count(): number {\n  let total = 0;\n${body}  return total;\n}\n`;
}

function branches(name: string, count: number): string {
  const tests = Array.from({ length: count }, (_, index) => `  if (x === ${index}) return ${index};\n`).join("");
  return `export function ${name}(x: number): number {\n${tests}  return -1;\n}\n`;
}

function repository(size: Record<string, unknown> = SIZE): Promise<FixtureRepo> {
  return open({ "quality.json": JSON.stringify({ sources: { production: ["src/**/*.ts"] }, size }) });
}

test(
  "without oxlint to run it cannot decide, and exits 2",
  async () => {
    const { dir, write, commit } = await open({ "quality.json": JSON.stringify({ sources: { production: ["src/**/*.ts"] }, size: SIZE }) });
    await write({ "src/small.ts": constants(2) });
    const first = await commit("feat: first");
    const result = await $`${process.execPath} ${SCRIPT} ${first}`.cwd(dir).env({ ...process.env, PATH: dirname(Bun.which("git") ?? "/usr/bin/git") }).nothrow().quiet();
    expect(result.stderr.toString()).toContain("size-budget: cannot run oxlint");
    expect(result.exitCode).toBe(2);
  },
  60_000,
);

test(
  "a first commit is judged against the empty tree by the kit's default budget, through the plugin, with tests/ held to their own",
  async () => {
    const { write, commit, script } = await repository({});
    await write({ "src/guards.ts": branches("guards", 16), "src/busy.ts": counter(29), "tests/busy.test.ts": counter(29) });
    const first = await commit("feat: first");

    const red = await script(BUDGET, first);
    expect(red.text).toContain("size-budget: 2 overrun(s) grew past the base in the production and test files the range adds or changes:\n");
    expect(red.text).toContain(
      "  src/busy.ts: max-statements over by 1 in total, up from 0\n" +
        "    src/busy.ts:1: function `count` has too many statements (31). Maximum allowed is 30.\n",
    );
    expect(red.text).toContain(
      "  src/guards.ts: cognitive-complexity over by 1 in total, up from 0\n" +
        "    src/guards.ts:1: function `guards` has a cognitive complexity of 16. Maximum allowed is 15.\n",
    );
    expect(red.text).not.toContain("tests/");
    expect(red.exitCode).toBe(1);
  },
  60_000,
);

test(
  "the range runs from the merge base to the head commit, measuring an edited rename against the file it was renamed from",
  async () => {
    const { dir, write, commit, script } = await repository();
    await write({ "src/legacy.ts": constants(30), "src/small.ts": constants(2) });
    await commit("feat: base");
    await $`git checkout -q -b feature && mkdir -p src/lib && git mv src/legacy.ts src/lib/legacy.ts`.cwd(dir).quiet();
    await write({ "src/lib/legacy.ts": `${constants(29)}export const value29 = 99;\n`, "src/grown.ts": constants(30, "grown") });
    const head = await commit("feat: move and grow");
    await $`git checkout -q main`.cwd(dir).quiet();
    await write({ "src/legacy.ts": constants(21) });
    await commit("refactor: shrink on main");
    await $`git checkout -q feature`.cwd(dir).quiet();
    await write({ "src/grown.ts": constants(2, "grown"), "src/small.ts": constants(40) });

    const red = await script(BUDGET, "main", head);
    expect(red.text).toContain(
      "size-budget: 1 overrun(s) grew past the base in the production and test files the range adds or changes:\n" +
        "  src/grown.ts: max-lines over by 10 in total, up from 0\n" +
        "    src/grown.ts: File has too many lines (30). Maximum allowed is 20.\n",
    );
    expect(red.text).toContain("size-budget: advisory, 1 overrun(s) where the budget does not hold yet:\n  src/lib/legacy.ts: File has too many lines (30).");
    expect(red.text).not.toContain("small.ts");
    expect(red.exitCode).toBe(1);
  },
  60_000,
);

test(
  "checks-lint runs the size budget and the feature owners over its range, red on each and green once both hold",
  async () => {
    const { dir, write, commit, lint } = await guardrails({
      ...(await lintWiring({
        sources: { production: ["src/**/*.ts"] },
        size: SIZE,
        features: [{ name: "billing", root: "src/billing", entries: ["src/billing/index.ts"], proof: "tests/e2e/billing.test.ts" }],
      })),
      "src/billing/index.ts": "export const charge = 1;\n",
    });
    await commit("feat: base");
    await $`git update-ref refs/remotes/origin/main HEAD && git checkout -q -b feature`.cwd(dir).quiet();
    await write({ "src/billing/ledger.ts": constants(30) });
    await commit("feat: ledger");

    const red = await lint();
    expect(red.text).toContain("  src/billing/ledger.ts: File has too many lines (30).");
    expect(red.text).toContain("  billing: proof tests/e2e/billing.test.ts is not in the head commit");
    expect(red.text).toContain("checks-lint: 2 of 11 gate(s) failed: checks-size-budget, checks-feature-owners\n");
    expect(red.exitCode).toBe(1);

    await write({
      "src/billing/ledger.ts": constants(2),
      "tests/e2e/billing.test.ts": `import { expect, test } from "bun:test";\nimport { charge } from "../../src/billing/index.ts";\n\ntest("charges", () => {\n  expect(charge).toBe(1);\n});\n`,
    });
    await commit("fix: guardrails");
    const green = await lint();
    expect(green.text).toContain("checks-lint: 11 gate(s) pass\n");
    expect(green.exitCode).toBe(0);
  },
  60_000,
);
