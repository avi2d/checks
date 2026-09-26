import { $ } from "bun";
import { expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { CHECKOUT, fixtureRepos, lintWiring, sizeOverride, type FixtureRepo } from "./lib/fixture-repo.ts";

const BUDGET = "size-budget.ts";
const SCRIPT = join(CHECKOUT, "scripts", BUDGET);
const SIZE = { production: { fileLines: 20, functionLines: 5 } };
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

function repository(size: { readonly production?: { readonly fileLines?: number; readonly functionLines?: number } } = SIZE): Promise<FixtureRepo> {
  return open({ ".oxlintrc.json": sizeOverride(["src/**/*.ts"], size.production) });
}

test(
  "without oxlint to run it cannot decide, and exits 2",
  async () => {
    const { dir, write, commit } = await repository();
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
    expect(red.text).toContain("size-budget: 2 overrun(s) grew past the base in the files the range adds or changes:\n");
    expect(red.text).toContain(
      "  src/busy.ts: max-statements over at 1 site(s), up from 0\n" +
        "    src/busy.ts:1: function `count` has too many statements (31). Maximum allowed is 30.\n",
    );
    expect(red.text).toContain(
      "  src/guards.ts: cognitive-complexity over at 1 site(s), up from 0\n" +
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
      "size-budget: 1 overrun(s) grew past the base in the files the range adds or changes:\n" +
        "  src/grown.ts: max-lines over at 1 site(s), up from 0\n" +
        "    src/grown.ts: File has too many lines (30). Maximum allowed is 20.\n",
    );
    expect(red.text).toContain("size-budget: advisory, 1 overrun(s) where the budget does not hold yet:\n  src/lib/legacy.ts: File has too many lines (30).");
    expect(red.text).not.toContain("small.ts");
    expect(red.exitCode).toBe(1);
  },
  60_000,
);

test(
  "checks-lint runs the native size budget over its range, red on growth and green once fixed",
  async () => {
    const { dir, write, commit, lint } = await guardrails({
      ...(await lintWiring()),
      ".oxlintrc.json": sizeOverride(["src/**/*.ts"], SIZE.production),
      "src/billing/index.ts": "export const charge = 1;\n",
    });
    await commit("feat: base");
    await $`git update-ref refs/remotes/origin/main HEAD && git checkout -q -b feature`.cwd(dir).quiet();
    await write({ "src/billing/ledger.ts": constants(30) });
    await commit("feat: ledger");

    const red = await lint();
    expect(red.text).toContain("  src/billing/ledger.ts: File has too many lines (30).");
    expect(red.text).toContain("checks-lint: 1 of 10 gate(s) failed: checks-size-budget\n");
    expect(red.exitCode).toBe(1);

    await write({
      "src/billing/ledger.ts": constants(2),
    });
    await commit("fix: guardrails");
    const green = await lint();
    expect(green.text).toContain("checks-lint: 10 gate(s) pass\n");
    expect(green.exitCode).toBe(0);
  },
  60_000,
);

function maxLines(severity: unknown, max: number, files: readonly string[] = ["src/**/*.ts"]): { readonly files: readonly string[]; readonly rules: Readonly<Record<string, unknown>> } {
  return { files, rules: { "max-lines": [severity, { max, skipBlankLines: false, skipComments: false }] } };
}

function oxlintrc(...overrides: readonly ReturnType<typeof maxLines>[]): string {
  return JSON.stringify({ plugins: ["eslint"], categories: { correctness: "off" }, overrides });
}

for (const severity of ["warn", 1] as const) {
  test(
    `a size rule at ${JSON.stringify(severity)} holds existing debt where it stands and fails its growth`,
    async () => {
      const { write, commit, script } = await open({ ".oxlintrc.json": oxlintrc(maxLines(severity, 20)), "src/legacy.ts": constants(30) });
      const base = await commit("feat: debt");
      await write({ "src/legacy.ts": `${constants(29)}export const value29 = 99;\n` });
      const kept = await commit("refactor: edit in place");
      const green = await script(BUDGET, base, kept);
      expect(green.text).toContain("size-budget: 1 file(s), the files the range adds or changes, raise no overrun past the base");
      expect(green.text).toContain("size-budget: advisory, 1 overrun(s) where the budget does not hold yet:\n  src/legacy.ts: File has too many lines (30).");
      expect(green.exitCode).toBe(0);

      await write({ "src/legacy.ts": constants(31) });
      const grown = await commit("feat: grow the debt");
      const red = await script(BUDGET, base, grown);
      expect(red.text).toContain("  src/legacy.ts: max-lines over by 11, up from 10\n");
      expect(red.exitCode).toBe(1);
    },
    60_000,
  );
}

test(
  "each override holds its own files to its own limit, as oxlint reads it",
  async () => {
    const config = (scriptsMax: number): string => oxlintrc(maxLines("error", 3), maxLines("error", scriptsMax, ["scripts/**/*.ts"]));
    const { write, commit, script } = await open({ ".oxlintrc.json": config(1), "src/index.ts": constants(1), "scripts/tool.ts": constants(1, "tool") });
    const base = await commit("feat: start");
    await write({ "src/index.ts": constants(3), "scripts/tool.ts": constants(2, "tool") });
    const head = await commit("feat: grow both");
    const red = await script(BUDGET, base, head);
    expect(red.text).toContain("  scripts/tool.ts: max-lines over at 1 site(s), up from 0\n");
    expect(red.text).not.toContain("src/index.ts");
    expect(red.exitCode).toBe(1);

    await write({ ".oxlintrc.json": config(2) });
    const raised = await commit("chore: raise the scripts limit");
    const green = await script(BUDGET, base, raised);
    expect(green.exitCode).toBe(0);
  },
  60_000,
);

test(
  "trimming one function over its limit never pays for a new function over it",
  async () => {
    const config = JSON.stringify({
      plugins: ["eslint"],
      categories: { correctness: "off" },
      rules: { "max-lines-per-function": ["warn", { max: 5, skipBlankLines: false, skipComments: false }] },
    });
    const { write, commit, script } = await open({ ".oxlintrc.json": config, "src/a.ts": counter(33) });
    const base = await commit("feat: f is 30 over");
    await write({ "src/a.ts": `${counter(13)}${counter(18).replace("count", "tally")}` });
    const head = await commit("feat: trim f to 10 over and add g 20 over");
    const red = await script(BUDGET, base, head);
    expect(red.text).toContain("  src/a.ts: max-lines-per-function over at 2 site(s), up from 1\n");
    expect(red.exitCode).toBe(1);

    await write({ "src/a.ts": counter(13) });
    const trimmed = await commit("refactor: only trim f");
    const green = await script(BUDGET, base, trimmed);
    expect(green.text).toContain("raise no overrun past the base");
    expect(green.exitCode).toBe(0);
  },
  60_000,
);
