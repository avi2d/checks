import { $ } from "bun";
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CHECKOUT = resolve(import.meta.dir, "..", "..");
const SCRIPT = join(CHECKOUT, "scripts", "comment-gate.ts");

let dir = "";

afterEach(async () => {
  if (dir !== "") {
    await rm(dir, { recursive: true, force: true });
    dir = "";
  }
});

async function initRepo(): Promise<void> {
  dir = await mkdtemp(join(tmpdir(), "checks-comment-gate-"));
  await $`git init -q -b main`.cwd(dir).quiet();
  await $`git config user.name tester && git config user.email tester@example.com`.cwd(dir).quiet();
}

async function commit(message: string): Promise<string> {
  await $`git add -A && git commit -q --no-gpg-sign -m ${message}`.cwd(dir).quiet();
  const sha = await $`git rev-parse HEAD`.cwd(dir).quiet();
  return sha.stdout.toString().trim();
}

async function gate(...args: readonly string[]): Promise<{ exitCode: number; text: string }> {
  const result = await $`bun ${SCRIPT} ${args}`.cwd(dir).nothrow().quiet();
  return {
    exitCode: result.exitCode,
    text: result.stdout.toString() + result.stderr.toString(),
  };
}

test(
  "the gate goes red on a banned comment, green once it is removed",
  async () => {
    await initRepo();
    await writeFile(join(dir, "widget.ts"), "export const widget = 1;\n");
    const base = await commit("clean start");

    await writeFile(join(dir, "widget.ts"), "export const widget = 1;\n// @ts-expect-error silenced\n");
    const dirty = await commit("plant a banned comment");
    const red = await gate(base, dirty);
    expect(red.exitCode).toBe(1);
    expect(red.text).toContain("comment-gate: 1 violation(s):");
    expect(red.text).toContain("widget.ts:2 carries the machine-read directive `@ts-expect-error`");

    await writeFile(join(dir, "widget.ts"), "export const widget = 1;\n");
    const fixed = await commit("remove the banned comment");
    const green = await gate(dirty, fixed);
    expect(green.exitCode).toBe(0);
    expect(green.text).toContain("carry no refused comment");
  },
  120_000,
);

test(
  "a violation in a file the range never touches stays silent",
  async () => {
    await initRepo();
    await writeFile(join(dir, "legacy.ts"), "// @ts-expect-error old suppression\nexport const legacy = 1;\n");
    await writeFile(join(dir, "widget.ts"), "export const widget = 1;\n");
    const withViolation = await commit("violation lands in legacy");

    await writeFile(join(dir, "widget.ts"), "export const widget = 2;\n");
    const later = await commit("an unrelated change");
    const silent = await gate(withViolation, later);
    expect(silent.exitCode).toBe(0);
    expect(silent.text).toContain("carry no refused comment");
  },
  120_000,
);

test(
  "files outside the comment syntax stay green whatever the diff adds",
  async () => {
    await initRepo();
    await writeFile(join(dir, "notes.md"), "# notes\n");
    const base = await commit("clean start");

    await writeFile(join(dir, "notes.md"), "# notes\n\n<!-- TODO(owner/repo#12): rewrite -->\n");
    await writeFile(join(dir, "data.json"), '{"key": "value"}\n');
    const docs = await commit("docs and config only");
    const green = await gate(base, docs);
    expect(green.exitCode).toBe(0);
  },
  120_000,
);

test(
  "an extension that names an Object prototype key is skipped, not read as code",
  async () => {
    await initRepo();
    await writeFile(join(dir, "widget.ts"), "export const widget = 1;\n");
    const base = await commit("clean start");

    await writeFile(join(dir, "constructor"), "// @ts-expect-error not code\n");
    await writeFile(join(dir, "notes.toString"), "// @ts-expect-error not code\n");
    const odd = await commit("files whose extension is a prototype key");
    const green = await gate(base, odd);
    expect(green.text).toContain("carry no refused comment");
    expect(green.exitCode).toBe(0);
  },
  120_000,
);

test(
  "the one-argument form judges a root commit against the empty tree",
  async () => {
    await initRepo();
    await writeFile(join(dir, "widget.ts"), "export const widget = 1;\n");
    const clean = await commit("clean root");
    const green = await gate(clean);
    expect(green.exitCode).toBe(0);
    expect(green.text).toContain("comment-gate: 1 added line(s) across 1 file(s) carry no refused comment");

    await $`git checkout -q --orphan dirty`.cwd(dir).quiet();
    await writeFile(join(dir, "widget.ts"), "export const widget = 1;\n// @ts-expect-error silenced\n");
    const dirty = await commit("root with a banned comment");
    const red = await gate(dirty);
    expect(red.exitCode).toBe(1);
    expect(red.text).toContain("widget.ts:2 carries the machine-read directive `@ts-expect-error`");
  },
  120_000,
);

test(
  "the one-argument form refuses to guess when the parent commit is not fetched",
  async () => {
    await initRepo();
    await writeFile(join(dir, "legacy.ts"), "// @ts-expect-error old suppression\nexport const legacy = 1;\n");
    await commit("a legacy violation");
    await writeFile(join(dir, "widget.ts"), "export const widget = 1;\n");
    await commit("a clean change");

    const shallow = await mkdtemp(join(tmpdir(), "checks-comment-gate-shallow-"));
    try {
      await $`git clone -q --depth 1 ${`file://${dir}`} ${shallow}`.quiet();
      const result = await $`bun ${SCRIPT} HEAD`.cwd(shallow).nothrow().quiet();
      expect(result.exitCode).toBe(2);
      expect(result.stderr.toString()).toContain("comment-gate: git rev-parse");
    } finally {
      await rm(shallow, { recursive: true, force: true });
    }
  },
  120_000,
);
