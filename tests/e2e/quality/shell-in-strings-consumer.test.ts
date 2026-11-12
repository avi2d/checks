import { expect, test } from "bun:test";
import { join } from "node:path";
import { consumerTrees, KIT_BIN, type KitTree } from "../lib/consumer-tree.ts";
import type { Ran } from "../lib/fixture-repo.ts";

const HEAVY_ARRAY = `export const HEAVY = [
  "#!/bin/sh",
  'heavy_decision="$(cat "$1")"',
  'heavy_bun="$2"',
  '  if [ ! -x "$heavy_bun" ]; then',
  "    exit 1",
  "  fi",
  '  heavy_queue="\${heavy_decision% *}"',
  'exec "$heavy_bun" "$@"',
].join("\\n");
`;

const PLUS_CHAIN = `export const WAIT =
  "set -e\\n" +
  'while [ -n "$pending" ]; do\\n' +
  '  case "$pending" in\\n' +
  "    done) break ;;\\n" +
  "  esac\\n" +
  "done\\n";
`;

const FOUR_SHELL_LINES = `export const SHORT = ['if [ -f "$1" ]; then', '  cat "$1"', "fi", 'trap "rm -f $tmp" EXIT', 'mkdir -p "$out" && cd "$out"'].join("\\n");
`;

const BUN_EVAL = `export const PROBE = [
  "const args = process.argv.slice(2);",
  "if (args.length === 0 && process.env.CI) {",
  "  console.log(args.join(' ') || 'none');",
  "}",
  "if (args[0] === 'x' || args[1]) process.exit(1);",
  "const ok = args.length > 1 && args[1] !== '';",
  "while (args.length > 0 && ok) {",
  "  args.pop();",
  "}",
].join("\\n");
export const command = ["bun", "-e", PROBE];
`;

const FAKE_TOOL_FIXTURE = `import { test } from "bun:test";
const FAKE_GH = [
  "#!/bin/sh",
  'case "$1" in',
  '  pr) echo "$@" >> "$LOG" ;;',
  "  *) exit 1 ;;",
  "esac",
  'exec true "$@"',
].join("\\n");
test("fake gh", () => {
  void FAKE_GH;
});
`;

const consumerTree = consumerTrees("checks-shell-in-strings-consumer-");

async function shellTree(): Promise<KitTree> {
  const tree = await consumerTree({ paths: ["scripts/**/*.ts"], include: ["src/**/*.ts", "tests/**/*.ts"], types: [] });
  await tree.put("src/heavy.ts", HEAVY_ARRAY);
  await tree.put("src/wait.ts", PLUS_CHAIN);
  await tree.put("src/short.ts", FOUR_SHELL_LINES);
  await tree.put("src/probe.ts", BUN_EVAL);
  await tree.put("tests/unit/fake-gh.test.ts", FAKE_TOOL_FIXTURE);
  return tree;
}

function oxlint(tree: KitTree): Promise<Ran> {
  return tree.run(join(KIT_BIN, "oxlint"), ["-f", "unix", "src", "tests"]);
}

function shellFindings(text: string): readonly string[] {
  return [...text.matchAll(/^(\S+?:\d+):\d+: (.*) \[Error\/data-shape\(no-shell-in-strings\)\]$/gmu)].map(([, where = "", message = ""]) => `${where} ${message}`);
}

test(
  "the shell rule reports nothing until a repository turns it on, so a kit release turns no consumer red",
  async () => {
    const tree = await shellTree();
    const ran = await oxlint(tree);
    expect(shellFindings(ran.text)).toEqual([]);
  },
  120_000,
);

test(
  "the shell rule reports the first line and count of an array and a + chain, and skips JavaScript for bun -e, four shell lines and a #!/bin/sh fixture under tests/",
  async () => {
    const tree = await shellTree();
    await tree.put(
      "oxlint.config.ts",
      `import { defineConfig } from "@avi2dg/checks/oxlint";\n\nexport default defineConfig({ effect: false, rules: { "data-shape/no-shell-in-strings": "error" } });\n`,
    );
    const ran = await oxlint(tree);
    expect(ran.exitCode).not.toBe(0);
    expect(shellFindings(ran.text).toSorted()).toEqual([
      "src/heavy.ts:2 These strings hold 6 lines that read as shell, the first `#!/bin/sh`. Move the program to a .sh file the code runs, where a shell linter reads it.",
      "src/wait.ts:3 These strings hold 5 lines that read as shell, the first `while [ -n \"$pending\" ]; do`. Move the program to a .sh file the code runs, where a shell linter reads it.",
    ]);
  },
  120_000,
);
