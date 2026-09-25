import { $ } from "bun";
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHECKOUT, fixtureRepos, ran, type Ran } from "./lib/fixture-repo.ts";

const SCRIPT = join(CHECKOUT, "scripts", "suppressions-ratchet.ts");
const OXLINT = join(CHECKOUT, "node_modules", ".bin", "oxlint");
const RULES = JSON.stringify({ rules: { "eslint/no-debugger": "error" } });
const open = fixtureRepos("checks-suppressions-ratchet-");
const repository = () => open({ ".oxlintrc.json": RULES });

async function debuggers(cwd: string, file: string, count: number): Promise<void> {
  await writeFile(join(cwd, file), `export {};\n${"debugger;\n".repeat(count)}`);
}

async function oxlint(cwd: string, flag: "--suppress-all" | "--prune-suppressions"): Promise<void> {
  await $`${OXLINT} ${flag}`.cwd(cwd).quiet();
}

function ratchet(cwd: string, args: readonly string[]): Promise<Ran> {
  return ran($`bun ${SCRIPT} ${args}`.cwd(cwd));
}

test(
  "oxlint's own baseline goes red on a raised count and a new entry, green once lowered",
  async () => {
    const { dir, commit } = await repository();
    await debuggers(dir, "counted.ts", 1);
    await oxlint(dir, "--suppress-all");
    const base = await commit("baseline");

    await debuggers(dir, "counted.ts", 2);
    await oxlint(dir, "--suppress-all");
    const raised = await commit("raise a count");
    const rose = await ratchet(dir, [base, raised]);
    expect(rose.exitCode).toBe(1);
    expect(rose.text).toContain("suppressions-ratchet: 1 count(s) in oxlint-suppressions.json rose or appeared");
    expect(rose.text).toContain("  counted.ts no-debugger rose from 1 to 2");

    await debuggers(dir, "added.ts", 1);
    await oxlint(dir, "--suppress-all");
    const added = await commit("add a new entry");
    const appeared = await ratchet(dir, [added]);
    expect(appeared.exitCode).toBe(1);
    expect(appeared.text).toContain("  added.ts no-debugger appeared with 1");
    expect(appeared.text).not.toContain("counted.ts");

    await debuggers(dir, "counted.ts", 0);
    await rm(join(dir, "added.ts"));
    await oxlint(dir, "--prune-suppressions");
    const lowered = await commit("fix every new site and one old one");
    const green = await ratchet(dir, [added, lowered]);
    expect(green.exitCode).toBe(0);
    expect(green.text).toContain("no count in oxlint-suppressions.json rose or appeared (0 at the head, 2 lowered)");
  },
  120_000,
);

test(
  "a file missing at the base counts as empty, and missing at both passes",
  async () => {
    const { dir, write, commit } = await repository();
    await debuggers(dir, "counted.ts", 0);
    const bare = await commit("no baseline");
    await write({ "notes.md": "# notes\n" });
    const still = await commit("still no baseline");
    const none = await ratchet(dir, [bare, still]);
    expect(none.exitCode).toBe(0);
    expect(none.text).toContain("(0 at the head, 0 lowered)");

    await debuggers(dir, "counted.ts", 3);
    await oxlint(dir, "--suppress-all");
    const introduced = await commit("introduce the baseline");
    const red = await ratchet(dir, [introduced]);
    expect(red.exitCode).toBe(1);
    expect(red.text).toContain("  counted.ts no-debugger appeared with 3");
  },
  120_000,
);

test(
  "the base is read where the head branched, so a count the base branch lowered later is no rise",
  async () => {
    const { dir, write, commit } = await repository();
    await debuggers(dir, "counted.ts", 2);
    await oxlint(dir, "--suppress-all");
    await commit("baseline");

    await $`git switch -q -c feature`.cwd(dir).quiet();
    await write({ "notes.md": "# notes\n" });
    const untouched = await commit("feature leaves the baseline alone");

    await $`git switch -q main`.cwd(dir).quiet();
    await debuggers(dir, "counted.ts", 1);
    await oxlint(dir, "--prune-suppressions");
    await commit("main fixes a site");

    const stale = await ratchet(dir, ["main", untouched]);
    expect(stale.exitCode).toBe(0);

    await $`git switch -q feature`.cwd(dir).quiet();
    await debuggers(dir, "counted.ts", 3);
    await oxlint(dir, "--suppress-all");
    const raised = await commit("feature raises the count");
    const red = await ratchet(dir, ["main", raised]);
    expect(red.exitCode).toBe(1);
    expect(red.text).toContain("  counted.ts no-debugger rose from 2 to 3");
  },
  120_000,
);

test(
  "run from a package directory it reads that package's file, where oxlint writes it",
  async () => {
    const { dir, commit } = await repository();
    const pkg = join(dir, "packages", "app");
    await mkdir(pkg, { recursive: true });
    await writeFile(join(pkg, ".oxlintrc.json"), RULES);
    await debuggers(pkg, "counted.ts", 1);
    await oxlint(pkg, "--suppress-all");
    const base = await commit("package baseline");

    await debuggers(pkg, "counted.ts", 2);
    await oxlint(pkg, "--suppress-all");
    const raised = await commit("package raises its count");
    const fromPackage = await ratchet(pkg, [base, raised]);
    expect(fromPackage.exitCode).toBe(1);
    expect(fromPackage.text).toContain("  counted.ts no-debugger rose from 1 to 2");

    const fromRoot = await ratchet(dir, [base, raised]);
    expect(fromRoot.exitCode).toBe(0);
  },
  120_000,
);

test(
  "the one-argument form judges a root commit against the empty tree, so a baseline it carries has appeared",
  async () => {
    const { dir, commit } = await repository();
    await debuggers(dir, "counted.ts", 0);
    const clean = await commit("root without a baseline");
    const green = await ratchet(dir, [clean]);
    expect(green.exitCode).toBe(0);
    expect(green.text).toContain("(0 at the head, 0 lowered)");

    await $`git checkout -q --orphan suppressed`.cwd(dir).quiet();
    await debuggers(dir, "counted.ts", 2);
    await oxlint(dir, "--suppress-all");
    const suppressed = await commit("root with a baseline");
    const red = await ratchet(dir, [suppressed]);
    expect(red.exitCode).toBe(1);
    expect(red.text).toContain("  counted.ts no-debugger appeared with 2");
  },
  120_000,
);

test(
  "an unreadable baseline or an unfetched parent exits 2 rather than passing",
  async () => {
    const { dir, write, commit } = await repository();
    await write({ "oxlint-suppressions.json": '{"counted.ts": {"no-debugger": {"count": 1}}}' });
    await commit("baseline");
    await write({ "oxlint-suppressions.json": '{"counted.ts": {"no-debugger": 2}}' });
    await commit("hand-edited baseline");

    const malformed = await ratchet(dir, ["HEAD"]);
    expect(malformed.exitCode).toBe(2);
    expect(malformed.text).toContain("holds counted.ts no-debugger without a whole count");

    await write({ "oxlint-suppressions.json": '{"counted.ts": {"no-debugger": {"count": 1}}}' });
    await commit("restored baseline");
    const shallow = await mkdtemp(join(tmpdir(), "checks-suppressions-ratchet-shallow-"));
    try {
      await $`git clone -q --depth 1 ${`file://${dir}`} ${shallow}`.quiet();
      const unfetched = await ratchet(shallow, ["HEAD"]);
      expect(unfetched.exitCode).toBe(2);
      expect(unfetched.text).toContain("suppressions-ratchet: git rev-parse");
    } finally {
      await rm(shallow, { recursive: true, force: true });
    }

    const usage = await ratchet(dir, []);
    expect(usage.exitCode).toBe(2);
    expect(usage.text).toContain("usage: suppressions-ratchet.ts");
  },
  120_000,
);
