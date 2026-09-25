import { $ } from "bun";
import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { withoutPullRequestEvent } from "../lib/env.ts";

const CHECKOUT = resolve(import.meta.dir, "..", "..");
const SCRIPT = join(CHECKOUT, "scripts", "size-budget.ts");
const FIXTURE = ["-c", "user.name=Wren Fixture", "-c", "user.email=wren@example.com"];
const ENV = { ...process.env, PATH: `${join(CHECKOUT, "node_modules", ".bin")}:${process.env["PATH"] ?? ""}` };
const SIZE = { fileLines: 20, functionLines: 5, applies: "changed" };
const RATCHET = { applies: "ratchet", production: { fileLines: 20, functionLines: 5 } };

let dir = "";

afterEach(async () => {
  if (dir !== "") {
    await rm(dir, { recursive: true, force: true });
    dir = "";
  }
});

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

function cases(count: number): string {
  const arms = Array.from({ length: count }, (_, index) => `    case ${index}:\n      return ${index};\n`).join("");
  return `export function pick(x: number): number {\n  switch (x) {\n${arms}    default:\n      return -1;\n  }\n}\n`;
}

function nested(depth: number): string {
  const indent = (level: number) => "  ".repeat(level);
  const opening = Array.from({ length: depth }, (_, level) => `${indent(level + 1)}if (x > ${level}) {\n`).join("");
  const closing = Array.from({ length: depth }, (_, level) => `${indent(depth - level)}}\n`).join("");
  return `export function deep(x: number): number {\n${opening}${indent(depth + 1)}return x;\n${closing}  return 0;\n}\n`;
}

async function write(files: Readonly<Record<string, string>>): Promise<void> {
  for (const [name, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, name)), { recursive: true });
    await writeFile(join(dir, name), content);
  }
}

async function commit(message: string): Promise<string> {
  await $`git add -A && git ${FIXTURE} commit -q --no-gpg-sign -m ${message}`.cwd(dir).quiet();
  return (await $`git rev-parse HEAD`.cwd(dir).quiet()).stdout.toString().trim();
}

async function repository(size: Record<string, unknown> = SIZE): Promise<void> {
  dir = await mkdtemp(join(tmpdir(), "checks-size-budget-"));
  await $`git init -q -b main`.cwd(dir).quiet();
  await writeFile(join(dir, "quality.json"), JSON.stringify({ sources: { production: ["src/**/*.ts"] }, size }));
}

async function budget(...refs: readonly string[]): Promise<{ exitCode: number; text: string }> {
  const result = await $`bun ${SCRIPT} ${refs}`.cwd(dir).env(ENV).nothrow().quiet();
  return { exitCode: result.exitCode, text: result.stdout.toString() + result.stderr.toString() };
}

test(
  "red on an added production file over budget, green once it keeps within; unchanged files and tooling stay advisory",
  async () => {
    await repository();
    await write({ "src/legacy.ts": constants(30), "src/small.ts": constants(2), "tools/long.ts": constants(30) });
    const base = await commit("feat: base");
    await write({ "src/fresh.ts": counter(8), "src/small.ts": constants(3), "src/types.d.ts": constants(30, "declared") });
    const head = await commit("feat: fresh");

    const red = await budget(base, head);
    expect(red.text).toContain(
      "size-budget: 1 overrun(s) of the budget in the production and test files the range adds or changes:\n" +
        "  src/fresh.ts:1: The function `count` has too many lines (12). Maximum allowed is 5.\n",
    );
    expect(red.text).toContain("size-budget: advisory, 2 overrun(s) where the budget does not hold yet:\n");
    expect(red.text).toContain("  src/legacy.ts: File has too many lines (30). Maximum allowed is 20.\n");
    expect(red.text).toContain("  tools/long.ts: File has too many lines (30). Maximum allowed is 20.\n");
    expect(red.text).not.toContain("types.d.ts");
    expect(red.text).toContain(
      "size-budget: quality.json sets size.fileLines and size.functionLines, which a later minor release stops reading; move them into size.production\n",
    );
    expect(red.exitCode).toBe(1);

    await write({ "src/fresh.ts": counter(1) });
    const fixed = await commit("fix: shorter");
    const green = await budget(base, fixed);
    expect(green.text).toContain("size-budget: 2 file(s), the production and test files the range adds or changes, keep within the budget\n");
    expect(green.text).toContain("  src/legacy.ts: File has too many lines (30). Maximum allowed is 20.\n");
    expect(green.exitCode).toBe(0);
  },
  60_000,
);

test(
  "a rename that edits the file is held, while an unchanged rename and a deletion are not",
  async () => {
    await repository();
    await write({ "src/moved.ts": constants(30), "src/edited.ts": constants(30, "kept"), "src/gone.ts": constants(30, "gone") });
    const base = await commit("feat: base");
    await mkdir(join(dir, "src/lib"));
    await $`git mv src/moved.ts src/lib/moved.ts && git mv src/edited.ts src/lib/edited.ts && git rm -q src/gone.ts`.cwd(dir).quiet();
    await writeFile(join(dir, "src/lib/edited.ts"), `${constants(30, "kept")}export const added = true;\n`);
    const head = await commit("refactor: move");
    expect((await $`git diff --name-status -M ${base} ${head}`.cwd(dir).quiet()).stdout.toString()).toMatch(/^R100\tsrc\/moved\.ts/m);

    const red = await budget(base, head);
    expect(red.text).toContain(
      "in the production and test files the range adds or changes:\n  src/lib/edited.ts: File has too many lines (31). Maximum allowed is 20.\n",
    );
    expect(red.text).toContain("size-budget: advisory, 1 overrun(s) where the budget does not hold yet:\n  src/lib/moved.ts: File has too many lines (30).");
    expect(red.text).not.toContain("gone.ts");
    expect(red.exitCode).toBe(1);

    await $`git rm -q src/lib/edited.ts`.cwd(dir).quiet();
    const removed = await commit("refactor: drop");
    const green = await budget(base, removed);
    expect(green.text).toContain("size-budget: 0 file(s), the production and test files the range adds or changes, keep within");
    expect(green.exitCode).toBe(0);
  },
  60_000,
);

test(
  "the range starts at the merge base, so a change only the base branch made is not held against the head",
  async () => {
    await repository();
    await write({ "src/shared.ts": constants(2) });
    await commit("feat: base");
    await $`git checkout -q -b feature`.cwd(dir).quiet();
    await write({ "src/feature.ts": constants(2) });
    const head = await commit("feat: feature");
    await $`git checkout -q main`.cwd(dir).quiet();
    await write({ "src/shared.ts": constants(30) });
    await commit("feat: grow on main");

    const result = await budget("main", head);
    expect(result.text).toContain("size-budget: 1 file(s), the production and test files the range adds or changes, keep within");
    expect(result.exitCode).toBe(0);
  },
  60_000,
);

test(
  "applies all holds every production and test file, each to its own budget, while tooling stays advisory",
  async () => {
    await repository({ applies: "all", production: { fileLines: 20 }, tests: { fileLines: 25 } });
    await write({
      "src/legacy.ts": constants(30),
      "src/small.ts": constants(2),
      "tests/long.test.ts": constants(30),
      "tests/short.test.ts": constants(22),
      "tools/long.ts": constants(30),
    });
    await commit("feat: base");
    await write({ "src/small.ts": constants(3) });
    const head = await commit("feat: touch");

    const red = await budget(head);
    expect(red.text).toContain(
      "size-budget: 2 overrun(s) of the budget in every production and test file:\n" +
        "  src/legacy.ts: File has too many lines (30). Maximum allowed is 20.\n" +
        "  tests/long.test.ts: File has too many lines (30). Maximum allowed is 25.\n",
    );
    expect(red.text).toContain("size-budget: advisory, 1 overrun(s) where the budget does not hold yet:\n  tools/long.ts: File has too many lines (30).");
    expect(red.text).not.toContain("short.test.ts");
    expect(red.text).not.toContain("stops reading");
    expect(red.exitCode).toBe(1);
  },
  60_000,
);

test(
  "applies ratchet fails a change that raises a file's overrun, passes one that keeps or lowers it, and holds a new file to the budget",
  async () => {
    await repository(RATCHET);
    await write({ "src/legacy.ts": constants(30), "src/small.ts": constants(2) });
    const base = await commit("feat: base");
    await write({ "src/legacy.ts": constants(32) });
    const grown = await commit("feat: grow");
    await write({ "src/legacy.ts": `${constants(29)}export const value29 = 99;\n` });
    const kept = await commit("refactor: keep");

    const red = await budget(base, grown);
    expect(red.text).toContain(
      "size-budget: 1 overrun(s) grew past the base in the production and test files the range adds or changes:\n" +
        "  src/legacy.ts: max-lines over by 12 in total, up from 10\n" +
        "    src/legacy.ts: File has too many lines (32). Maximum allowed is 20.\n",
    );
    expect(red.exitCode).toBe(1);

    for (const from of [base, grown]) {
      const green = await budget(from, kept);
      expect(green.text).toContain("size-budget: 1 file(s), the production and test files the range adds or changes, raise no overrun past the base\n");
      expect(green.text).toContain("size-budget: advisory, 1 overrun(s) where the budget does not hold yet:\n  src/legacy.ts: File has too many lines (30).");
      expect(green.exitCode).toBe(0);
    }

    await write({ "src/fresh.ts": constants(21) });
    const fresh = await commit("feat: fresh");
    const added = await budget(kept, fresh);
    expect(added.text).toContain("  src/fresh.ts: max-lines over by 1 in total, up from 0\n    src/fresh.ts: File has too many lines (21).");
    expect(added.text).not.toContain("src/legacy.ts: max-lines");
    expect(added.exitCode).toBe(1);
  },
  60_000,
);

test(
  "applies ratchet sums each rule per file, so a shrink in another rule or another file does not pay for a growth",
  async () => {
    await repository(RATCHET);
    await write({ "src/wide.ts": `${counter(8)}${constants(22)}`, "src/other.ts": constants(30) });
    const base = await commit("feat: base");
    await write({ "src/wide.ts": `${counter(1)}${constants(40)}`, "src/other.ts": constants(21) });
    const head = await commit("refactor: trade");

    const red = await budget(base, head);
    expect(red.text).toContain("size-budget: 1 overrun(s) grew past the base in the production and test files the range adds or changes:\n");
    expect(red.text).toContain("  src/wide.ts: max-lines over by 25 in total, up from 14\n");
    expect(red.text).not.toContain("max-lines-per-function over");
    expect(red.text).not.toContain("src/other.ts: max-lines over");
    expect(red.exitCode).toBe(1);
  },
  60_000,
);

test(
  "applies ratchet measures an edited rename against the file it was renamed from",
  async () => {
    await repository(RATCHET);
    await write({ "src/legacy.ts": constants(30) });
    const base = await commit("feat: base");
    await mkdir(join(dir, "src/lib"));
    await $`git mv src/legacy.ts src/lib/legacy.ts`.cwd(dir).quiet();
    await write({ "src/lib/legacy.ts": `${constants(29)}export const value29 = 99;\n` });
    const moved = await commit("refactor: move");
    await write({ "src/lib/legacy.ts": constants(31) });
    const grown = await commit("feat: grow");

    const green = await budget(base, moved);
    expect(green.text).toContain("size-budget: 1 file(s), the production and test files the range adds or changes, raise no overrun past the base\n");
    expect(green.exitCode).toBe(0);

    const red = await budget(base, grown);
    expect(red.text).toContain("  src/lib/legacy.ts: max-lines over by 11 in total, up from 10\n");
    expect(red.exitCode).toBe(1);
  },
  60_000,
);

test(
  "tests under tests/ keep to their own budget, which has no limit on a function's lines",
  async () => {
    await repository({ applies: "changed", production: { fileLines: 20, functionLines: 5, statements: 4 }, tests: { fileLines: 30, statements: 6 } });
    await write({ "src/small.ts": constants(2) });
    const base = await commit("feat: base");
    await write({ "tests/wide.test.ts": constants(25), "tests/busy.test.ts": counter(8), "tests/long.test.ts": constants(31) });
    const head = await commit("test: add");

    const red = await budget(base, head);
    expect(red.text).toContain(
      "size-budget: 2 overrun(s) of the budget in the production and test files the range adds or changes:\n" +
        "  tests/busy.test.ts:1: function `count` has too many statements (10). Maximum allowed is 6.\n" +
        "  tests/long.test.ts: File has too many lines (31). Maximum allowed is 30.\n",
    );
    expect(red.text).not.toContain("wide.test.ts");
    expect(red.text).not.toContain("too many lines (12)");
    expect(red.exitCode).toBe(1);
  },
  60_000,
);

test(
  "the kit's recommended budget holds where quality.json states none, counting a switch once toward complexity",
  async () => {
    await repository({});
    await write({
      "src/branchy.ts": branches("branchy", 15),
      "src/switchy.ts": cases(20),
      "src/deep.ts": nested(5),
      "src/busy.ts": counter(29),
      "src/long.ts": constants(401),
      "src/fits.ts": `${branches("fits", 14)}${nested(4)}${counter(28)}${constants(300)}`,
      "tests/busy.test.ts": counter(48),
      "tests/long.test.ts": constants(600),
    });
    const first = await commit("feat: first");

    const red = await budget(first);
    expect(red.text).toContain("size-budget: 4 overrun(s) grew past the base in the production and test files the range adds or changes:\n");
    expect(red.text).toContain("    src/branchy.ts:1: function `branchy` has a complexity of 16. Maximum allowed is 15.\n");
    expect(red.text).toContain("    src/busy.ts:1: function `count` has too many statements (31). Maximum allowed is 30.\n");
    expect(red.text).toContain("    src/deep.ts:6: Blocks are nested too deeply (5). Maximum allowed is 4.\n");
    expect(red.text).toContain("    src/long.ts: File has too many lines (401). Maximum allowed is 400.\n");
    for (const fits of ["switchy.ts", "fits.ts", "tests/"]) expect(red.text).not.toContain(fits);
    expect(red.exitCode).toBe(1);
  },
  60_000,
);

test(
  "it measures the head commit, so an uncommitted edit neither fails nor passes the range",
  async () => {
    await repository();
    await write({ "src/small.ts": constants(2) });
    const base = await commit("feat: base");
    await write({ "src/grown.ts": constants(30) });
    const head = await commit("feat: grown");

    await write({ "src/grown.ts": constants(2), "src/small.ts": constants(40) });
    const committed = await budget(base, head);
    expect(committed.text).toContain("  src/grown.ts: File has too many lines (30).");
    expect(committed.text).not.toContain("small.ts");
    expect(committed.exitCode).toBe(1);
  },
  60_000,
);

test(
  "a first commit is judged against the empty tree, and a repository declaring no size passes saying so",
  async () => {
    await repository();
    await write({ "src/huge.ts": constants(30) });
    const first = await commit("feat: first");
    const red = await budget(first);
    expect(red.text).toContain("  src/huge.ts: File has too many lines (30).");
    expect(red.exitCode).toBe(1);

    await writeFile(join(dir, "quality.json"), JSON.stringify({ sources: { production: ["src/**/*.ts"] } }));
    const undeclared = await budget(first);
    expect(undeclared.text).toBe("size-budget: quality.json declares no size budget\n");
    expect(undeclared.exitCode).toBe(0);
  },
  60_000,
);

test(
  "without oxlint to run it cannot decide, and exits 2",
  async () => {
    await repository();
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
    dir = await mkdtemp(join(tmpdir(), "checks-lint-guardrails-"));
    await $`git init -q -b main`.cwd(dir).quiet();
    await write({
      "package.json": JSON.stringify({ name: "guardrails-fixture", type: "module", scripts: { lint: "checks-lint", test: "checks-test" } }),
      "bunfig.toml": await Bun.file(join(CHECKOUT, "bunfig.toml")).text(),
      ".github/workflows/ci.yml": "on: pull_request\njobs:\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - run: bun run lint\n",
      "quality.json": JSON.stringify({
        gates: { ci: ["bun run lint"] },
        commitIdentity: { authors: [{ name: "Wren Fixture", email: "wren@example.com" }] },
        sources: { production: ["src/**/*.ts"] },
        size: SIZE,
        features: [{ name: "billing", root: "src/billing", entries: ["src/billing/index.ts"], proof: "tests/e2e/billing.test.ts" }],
      }),
      "src/billing/index.ts": "export const charge = 1;\n",
    });
    await commit("feat: base");
    await $`git update-ref refs/remotes/origin/main HEAD && git checkout -q -b feature`.cwd(dir).quiet();
    await write({ "src/billing/ledger.ts": constants(30) });
    await commit("feat: ledger");

    const local = { ...withoutPullRequestEvent(), PATH: ENV.PATH };
    const lint = async () => {
      const result = await $`bun ${join(CHECKOUT, "scripts", "lint.ts")}`.cwd(dir).env(local).nothrow().quiet();
      return { exitCode: result.exitCode, text: result.stdout.toString() + result.stderr.toString() };
    };
    const red = await lint();
    expect(red.text).toContain("  src/billing/ledger.ts: File has too many lines (30).");
    expect(red.text).toContain("  billing: proof tests/e2e/billing.test.ts is not in the head commit");
    expect(red.text).toContain("checks-lint: 2 of 10 gate(s) failed: checks-size-budget, checks-feature-owners\n");
    expect(red.exitCode).toBe(1);

    await write({
      "src/billing/ledger.ts": constants(2),
      "tests/e2e/billing.test.ts": `import { expect, test } from "bun:test";\nimport { charge } from "../../src/billing/index.ts";\n\ntest("charges", () => {\n  expect(charge).toBe(1);\n});\n`,
    });
    await commit("fix: guardrails");
    const green = await lint();
    expect(green.text).toContain("checks-lint: 10 gate(s) pass\n");
    expect(green.exitCode).toBe(0);
  },
  60_000,
);
