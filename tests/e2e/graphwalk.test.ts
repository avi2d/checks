import { $ } from "bun";
import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CHECKOUT, fixtureRepos, ran } from "./lib/fixture-repo.ts";

const open = fixtureRepos("checks-graphwalk-");

const GRAPHWALK = join(CHECKOUT, "src", "complexity", "graphwalk.ts");

const STUCK_CONFIG = `import { writeFileSync } from "node:fs";
const sleeper = Bun.spawn(["sleep", "600"]);
writeFileSync(process.env["PIDS_FILE"] ?? "", \`\${process.pid} \${sleeper.pid}\`);
process.on("SIGTERM", () => {});
setInterval(() => {}, 60_000);
await new Promise(() => {});
export default {};
`;

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function survivorsOf(pidsFile: string): Promise<readonly number[]> {
  const pids = (await readFile(pidsFile, "utf8")).trim().split(" ").map(Number);
  expect(pids).toHaveLength(2);
  return pids.filter(isAlive);
}

function kitConfig(entry: readonly string[]): string {
  return `import { defineConfig } from "${CHECKOUT}/dist/presets/knip.js";\nexport default defineConfig({ entry: ${JSON.stringify(entry)} });\n`;
}

test(
  "the combined walk reports all three sections instead of dropping one gate findings, red on each tripped section and green once all three hold",
  async () => {
    const { dir, write, commit, script } = await open({
      "package.json": JSON.stringify({ name: "graphwalk-oracle", type: "module" }),
      "knip.config.ts": kitConfig(["src/index.ts"]),
      "exports-baseline.json": "[]\n",
      "src/index.ts": `import { used } from "./used.ts";\n\nexport const index = used;\n`,
      "src/used.ts": `export const used = 1;\nexport const unusedExport = 2;\nexport type UnusedOptions = { readonly flag: boolean };\n`,
      "src/dead.ts": `export const dead = 1;\n`,
    });
    const base = await commit("feat: base");

    const red = await script("complexity/graphwalk.ts", base, "HEAD");
    expect(red.text).toBe(
      [
        "unused: 1 unreferenced file(s):",
        "  src/dead.ts",
        "exports: 2 unused export(s) not in exports-baseline.json:",
        "  src/used.ts: unusedExport (export)",
        "  src/used.ts: UnusedOptions (type)",
        "imports: 1 violation(s) in 5 module(s) cruised against the kit\u0027s defaults",
        "  error no-orphans: src/dead.ts",
        "",
      ].join("\n"),
    );
    expect(red.exitCode).toBe(1);

    await $`rm src/dead.ts && git add -A`.cwd(dir).quiet();
    await write({ 'src/used.ts': `export const used = 1;\n` });
    await commit("fix: remove the dead file and use every export");
    const green = await script("complexity/graphwalk.ts", base, "HEAD");
    expect(green.text).toContain("unused: no unreferenced files among 3 tracked .ts/.tsx/.astro file(s)\n");
    expect(green.text).toContain("exports: no unused exports or types\n");
    expect(green.text).toContain("cruised against the kit\u0027s defaults, no violation\n");
    expect(green.exitCode).toBe(0);
  },
  120_000,
);

test(
  "a repository with only .mts files still cruises its imports instead of reporting no tracked source",
  async () => {
    const { commit, script } = await open({
      "package.json": JSON.stringify({ name: "graphwalk-mts-only", type: "module" }),
      "src/a.mts": `import { b } from "./b.mts";\nexport const a = b;\n`,
      "src/b.mts": `import { a } from "./a.mts";\nexport const b = a;\n`,
    });
    await commit("feat: cycle");

    const red = await script("complexity/graphwalk.ts");
    expect(red.text).toContain("imports:");
    expect(red.text).toContain("violation(s)");
    expect(red.text).toContain("no-circular");
    expect(red.text).not.toContain("no tracked TypeScript or Astro source");
    expect(red.exitCode).toBe(1);
  },
  120_000,
);

test(
  "a dependency-cruiser child that never exits fails the imports section at its time limit instead of holding the gate open, and leaves no process behind",
  async () => {
    const { dir, commit } = await open({
      "package.json": JSON.stringify({ name: "graphwalk-stuck-cruise", type: "module" }),
      "knip.config.ts": kitConfig(["src/index.ts"]),
      "exports-baseline.json": "[]\n",
      "src/index.ts": "export const index = 1;\n",
      "dependency-cruiser.config.ts": STUCK_CONFIG,
    });
    await commit("feat: a cruise config that never loads");
    const pidsFile = join(dir, ".git", "stuck-pids");

    const stuck = await ran(
      $`bun ${GRAPHWALK}`.cwd(dir).env({ ...process.env, CHECKS_DEPCRUISE_TIMEOUT_SECONDS: "2", PIDS_FILE: pidsFile }),
    );
    expect(stuck.text).toContain("imports: dependency-cruiser timed out after 2s; set CHECKS_DEPCRUISE_TIMEOUT_SECONDS to allow longer\n");
    expect(stuck.text).not.toContain("graphwalk: timed out");
    expect(stuck.exitCode).toBe(2);
    expect(await survivorsOf(pidsFile)).toEqual([]);
  },
  120_000,
);

test(
  "a graphwalk run whose scanner never exits fails the gate at its time limit instead of running on, and leaves no process behind",
  async () => {
    const { dir, commit } = await open({
      "package.json": JSON.stringify({ name: "graphwalk-stuck-knip", type: "module" }),
      "knip.config.ts": STUCK_CONFIG,
      "src/index.ts": "export const index = 1;\n",
    });
    await commit("feat: a knip config that never loads");
    const pidsFile = join(dir, ".git", "stuck-pids");

    const stuck = await ran($`bun ${GRAPHWALK}`.cwd(dir).env({ ...process.env, CHECKS_GRAPHWALK_TIMEOUT_SECONDS: "3", PIDS_FILE: pidsFile }));
    expect(stuck.text).toBe("graphwalk: timed out after 3s; set CHECKS_GRAPHWALK_TIMEOUT_SECONDS to allow longer\n");
    expect(stuck.exitCode).toBe(2);
    expect(await survivorsOf(pidsFile)).toEqual([]);
  },
  120_000,
);

