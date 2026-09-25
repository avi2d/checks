import { $ } from "bun";
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHECKOUT, fixtureRepos } from "./lib/fixture-repo.ts";

const GATE = "comment-gate.ts";
const repository = fixtureRepos("checks-comment-gate-");

test(
  "the gate goes red on a banned comment, green once it is removed",
  async () => {
    const { write, commit, script } = await repository();
    await write({ "widget.ts": "export const widget = 1;\n" });
    const base = await commit("clean start");

    await write({ "widget.ts": "export const widget = 1;\n// @ts-expect-error silenced\n" });
    const dirty = await commit("plant a banned comment");
    const red = await script(GATE, base, dirty);
    expect(red.exitCode).toBe(1);
    expect(red.text).toContain("comment-gate: 1 violation(s):");
    expect(red.text).toContain("widget.ts:2 carries the machine-read directive `@ts-expect-error`");

    await write({ "widget.ts": "export const widget = 1;\n" });
    const fixed = await commit("remove the banned comment");
    const green = await script(GATE, dirty, fixed);
    expect(green.exitCode).toBe(0);
    expect(green.text).toContain("carry no refused comment");
  },
  120_000,
);

test(
  "a violation in a file the range never touches stays silent",
  async () => {
    const { write, commit, script } = await repository();
    await write({ "legacy.ts": "// @ts-expect-error old suppression\nexport const legacy = 1;\n", "widget.ts": "export const widget = 1;\n" });
    const withViolation = await commit("violation lands in legacy");

    await write({ "widget.ts": "export const widget = 2;\n" });
    const later = await commit("an unrelated change");
    const silent = await script(GATE, withViolation, later);
    expect(silent.exitCode).toBe(0);
    expect(silent.text).toContain("carry no refused comment");
  },
  120_000,
);

test(
  "files outside the comment syntax stay green whatever the diff adds",
  async () => {
    const { write, commit, script } = await repository();
    await write({ "notes.md": "# notes\n" });
    const base = await commit("clean start");

    await write({ "notes.md": "# notes\n\n<!-- TODO(owner/repo#12): rewrite -->\n", "data.json": '{"key": "value"}\n' });
    const docs = await commit("docs and config only");
    const green = await script(GATE, base, docs);
    expect(green.exitCode).toBe(0);
  },
  120_000,
);

test(
  "an extension that names an Object prototype key is skipped, not read as code",
  async () => {
    const { write, commit, script } = await repository();
    await write({ "widget.ts": "export const widget = 1;\n" });
    const base = await commit("clean start");

    await write({ "constructor": "// @ts-expect-error not code\n", "notes.toString": "// @ts-expect-error not code\n" });
    const odd = await commit("files whose extension is a prototype key");
    const green = await script(GATE, base, odd);
    expect(green.text).toContain("carry no refused comment");
    expect(green.exitCode).toBe(0);
  },
  120_000,
);

test(
  "the one-argument form judges a root commit against the empty tree",
  async () => {
    const { dir, write, commit, script } = await repository();
    await write({ "widget.ts": "export const widget = 1;\n" });
    const clean = await commit("clean root");
    const green = await script(GATE, clean);
    expect(green.exitCode).toBe(0);
    expect(green.text).toContain("comment-gate: 1 added line(s) across 1 file(s) carry no refused comment");

    await $`git checkout -q --orphan dirty`.cwd(dir).quiet();
    await write({ "widget.ts": "export const widget = 1;\n// @ts-expect-error silenced\n" });
    const dirty = await commit("root with a banned comment");
    const red = await script(GATE, dirty);
    expect(red.exitCode).toBe(1);
    expect(red.text).toContain("widget.ts:2 carries the machine-read directive `@ts-expect-error`");
  },
  120_000,
);

test(
  "the one-argument form refuses to guess when the parent commit is not fetched",
  async () => {
    const { dir, write, commit } = await repository();
    await write({ "legacy.ts": "// @ts-expect-error old suppression\nexport const legacy = 1;\n" });
    await commit("a legacy violation");
    await write({ "widget.ts": "export const widget = 1;\n" });
    await commit("a clean change");

    const shallow = await mkdtemp(join(tmpdir(), "checks-comment-gate-shallow-"));
    try {
      await $`git clone -q --depth 1 ${`file://${dir}`} ${shallow}`.quiet();
      const result = await $`bun ${join(CHECKOUT, "scripts", GATE)} HEAD`.cwd(shallow).nothrow().quiet();
      expect(result.exitCode).toBe(2);
      expect(result.stderr.toString()).toContain("comment-gate: git rev-parse");
    } finally {
      await rm(shallow, { recursive: true, force: true });
    }
  },
  120_000,
);
