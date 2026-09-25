import { $ } from "bun";
import { expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { CHECKOUT, fixtureRepos, lintWiring } from "./lib/fixture-repo.ts";

const BUDGET = "size-budget.ts";
const SCRIPT = join(CHECKOUT, "scripts", BUDGET);
const SIZE = { applies: "ratchet", production: { fileLines: 20, functionLines: 5 } };
const open = fixtureRepos("checks-size-budget-");
const guardrails = fixtureRepos("checks-lint-guardrails-");

function constants(count: number, prefix = "value"): string {
  return Array.from({ length: count }, (_, index) => `export const ${prefix}${index} = ${index};\n`).join("");
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
