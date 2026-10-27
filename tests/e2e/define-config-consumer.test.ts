import { $ } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import severities from "../../src/quality/presets/effect.language-service.json" with { type: "json" };
import kitTsconfig from "../../tsconfig.effect.json" with { type: "json" };
import { withoutPullRequestEvent } from "../lib/env.ts";
import { findings } from "./lib/findings.ts";
import { CHECKOUT, ran, type Ran } from "./lib/fixture-repo.ts";

const OXLINT_CONFIG = `import { defineConfig } from "@avi2dg/checks/oxlint";

export default defineConfig({ effect: true });
`;

const KNIP_CONFIG = `import { defineConfig } from "@avi2dg/checks/knip";

export default defineConfig({ entry: ["src/index.ts"] });
`;

const CRUISE_CONFIG = `import { defineConfig } from "@avi2dg/checks/dependency-cruiser";

export default defineConfig();
`;

const STYLELINT_CONFIG = `import { defineConfig } from "@avi2dg/checks/stylelint";

export default defineConfig({ baseline: "widely", tokens: ["src/tokens.css"] });
`;

const TREE: Readonly<Record<string, string>> = {
  ".gitignore": "node_modules/\n",
  "src/index.ts": `import { Effect } from "effect";\nimport { double } from "./double.ts";\n\nexport const program = Effect.succeed(double(21));\n`,
  "src/double.ts": `export function double(value: number): number {\n  return value * 2;\n}\n`,
  "tests/unit/double.test.ts": `import { expect, test } from "bun:test";\nimport { double } from "../../src/double.ts";\n\ntest("double", () => {\n  expect(double(2)).toBe(4);\n});\n`,
  "oxlint.config.ts": OXLINT_CONFIG,
  "knip.config.ts": KNIP_CONFIG,
  "dependency-cruiser.config.ts": CRUISE_CONFIG,
  "stylelint.config.ts": STYLELINT_CONFIG,
  "frontend-syntax.json": JSON.stringify({ inputs: ["src/**/*.css"] }),
  "src/tokens.css": ":root {\n  --ink: #1c1d20;\n}\n",
  "src/site.css": "a {\n  color: var(--ink);\n}\n",
  "tsconfig.json": JSON.stringify({
    extends: "@avi2dg/checks/tsconfig.effect.json",
    compilerOptions: { target: "esnext", module: "preserve", moduleResolution: "bundler", strict: true, noEmit: true, skipLibCheck: true, allowImportingTsExtensions: true, types: ["bun"] },
    include: ["src/**/*.ts", "tests/**/*.ts", "*.config.ts"],
  }),
};

const REFUSED_TYPES: Readonly<Record<string, readonly [config: string, code: string]>> = {
  "missing-effect.ts": [`import { defineConfig } from "@avi2dg/checks/oxlint";\nexport default defineConfig({ ignorePatterns: ["dist/**"] });\n`, "TS2345"],
  "effect-as-string.ts": [`import { defineConfig } from "@avi2dg/checks/oxlint";\nexport default defineConfig({ effect: "src/**/*.ts" });\n`, "TS2322"],
  "empty-files.ts": [`import { defineConfig } from "@avi2dg/checks/oxlint";\nexport default defineConfig({ effect: { files: [] } });\n`, "TS2322"],
  "kit-owned-plugins.ts": [`import { defineConfig } from "@avi2dg/checks/oxlint";\nexport default defineConfig({ effect: true, plugins: ["unicorn"] });\n`, "TS2353"],
  "wrong-rule-option.ts": [
    `import { defineConfig } from "@avi2dg/checks/oxlint";\nexport default defineConfig({ effect: true, overrides: [{ files: ["src/a.ts"], rules: { "max-lines": ["error", { maximum: 900 }] } }] });\n`,
    "TS2353",
  ],
  "knip-missing-entry.ts": [`import { defineConfig } from "@avi2dg/checks/knip";\nexport default defineConfig({ ignore: ["generated/**"] });\n`, "TS2345"],
  "knip-entry-string.ts": [`import { defineConfig } from "@avi2dg/checks/knip";\nexport default defineConfig({ entry: "src/index.ts" });\n`, "TS2322"],
  "knip-kit-owned-include.ts": [`import { defineConfig } from "@avi2dg/checks/knip";\nexport default defineConfig({ entry: [], include: ["exports"] });\n`, "TS2353"],
  "cruise-extends.ts": [`import { defineConfig } from "@avi2dg/checks/dependency-cruiser";\nexport default defineConfig({ extends: "./other.cjs" });\n`, "TS2353"],
  "cruise-bad-severity.ts": [
    `import { defineConfig } from "@avi2dg/checks/dependency-cruiser";\nexport default defineConfig({ forbidden: [{ name: "x", severity: "fatal", from: {}, to: {} }] });\n`,
    "TS2322",
  ],
  "stylelint-missing-baseline.ts": [`import { defineConfig } from "@avi2dg/checks/stylelint";\nexport default defineConfig({ tokens: false });\n`, "TS2345"],
  "stylelint-baseline-string-year.ts": [`import { defineConfig } from "@avi2dg/checks/stylelint";\nexport default defineConfig({ baseline: "2024", tokens: false });\n`, "TS2322"],
  "stylelint-empty-tokens.ts": [`import { defineConfig } from "@avi2dg/checks/stylelint";\nexport default defineConfig({ baseline: "widely", tokens: [] });\n`, "TS2322"],
  "stylelint-kit-owned-extends.ts": [
    `import { defineConfig } from "@avi2dg/checks/stylelint";\nexport default defineConfig({ baseline: "widely", tokens: false, extends: ["stylelint-config-recommended"] });\n`,
    "TS2353",
  ],
};

let packDir = "";
let dir = "";

beforeAll(async () => {
  packDir = await mkdtemp(join(tmpdir(), "checks-define-config-pack-"));
  const tarball = (await $`bun pm pack --destination ${packDir} --quiet --ignore-scripts`.cwd(CHECKOUT).quiet()).stdout.toString().trim();
  dir = await mkdtemp(join(tmpdir(), "checks-define-config-consumer-"));
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({
      name: "checks-define-config-fixture",
      type: "module",
      dependencies: { effect: "4.0.0" },
      devDependencies: {
        "@avi2dg/checks": `file:${tarball}`,
        "@swc/core": "1.16.2",
        "@types/bun": "1.4.2",
        "dependency-cruiser": "18.4.0",
        oxlint: "1.83.0",
        "oxlint-tsgolint": "7.0.2002",
        "postcss-html": "2.0.0",
        "postcss-value-parser": "4.2.0",
        stylelint: "17.16.0",
        "stylelint-config-standard": "40.0.0",
        "stylelint-plugin-use-baseline": "1.4.7",
        typescript: "7.0.2",
      },
    }),
  );
  await $`bun install`.cwd(dir).quiet();
  await put(TREE);
  await $`git init -q -b main && git add -A`.cwd(dir).quiet();
}, 360_000);

afterAll(async () => {
  for (const one of [dir, packDir]) if (one) await rm(one, { recursive: true, force: true });
}, 60_000);

async function put(files: Readonly<Record<string, string>>): Promise<void> {
  for (const [file, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, file)), { recursive: true });
    await writeFile(join(dir, file), content);
  }
}

function bin(name: string, args: readonly string[] = []): Promise<Ran> {
  return ran($`${join(dir, "node_modules", ".bin", name)} ${args}`.cwd(dir).env(withoutPullRequestEvent()));
}

async function oxlint(): Promise<{ readonly exitCode: number; readonly text: string; readonly linted: ReadonlyMap<string, readonly string[]> }> {
  const run = await bin("oxlint", ["-f", "unix"]);
  return { ...run, linted: findings(run.text, /^(\S+?):\d+:\d+: .*\[Error\/([^\]]+)\]$/gm) };
}

const ASYNC = "export async function later(): Promise<number> {\n  return 1;\n}\n";

function statements(count: number): string {
  return `export function tally(): number {\n  let total = 0;\n${"  total += 1;\n".repeat(count - 2)}  return total;\n}\n`;
}

test(
  "oxlint loads oxlint.config.ts through the installed kit: the Effect rules and the source budget hold src/, the test budget holds tests/",
  async () => {
    await put({ "src/later.ts": ASYNC, "src/tally.ts": statements(31), "tests/unit/later.ts": ASYNC, "tests/unit/tally.ts": statements(31) });
    const red = await oxlint();
    expect(red.exitCode).not.toBe(0);
    expect(red.linted.get("src/later.ts")).toContain("oxc(no-async-await)");
    expect(red.linted.get("src/tally.ts")).toContain("eslint(max-statements)");
    expect(red.linted.get("tests/unit/later.ts")).toBeUndefined();
    expect(red.linted.get("tests/unit/tally.ts")).toBeUndefined();

    for (const file of ["src/later.ts", "src/tally.ts", "tests/unit/later.ts", "tests/unit/tally.ts"]) await rm(join(dir, file));
    const green = await oxlint();
    expect(green.text).toBe("");
    expect(green.exitCode).toBe(0);
  },
  180_000,
);

test(
  "an override that turns off promise/avoid-new for one file, without naming the plugin, stops reporting that file alone",
  async () => {
    const promised =
      "export function later(): Promise<number> {\n  return new Promise((resolve) => resolve(1));\n}\nexport const settled = Promise.resolve(1, 2);\nexport const thenable = { then: 1 };\n";
    await put({ "src/bridge.ts": promised, "src/other.ts": promised });
    await put({
      "oxlint.config.ts": OXLINT_CONFIG.replace(
        "{ effect: true }",
        '{\n  effect: true,\n  overrides: [\n    // The host API hands back a callback, so the bridge builds the Promise itself.\n    { files: ["src/bridge.ts"], rules: { "promise/avoid-new": "off" } },\n  ],\n}',
      ),
    });
    const linted = await oxlint();
    expect(linted.linted.get("src/bridge.ts")).toBeUndefined();
    expect(linted.linted.get("src/other.ts")).toEqual(["promise(avoid-new)"]);

    for (const file of ["src/bridge.ts", "src/other.ts"]) await rm(join(dir, file));
    await put({ "oxlint.config.ts": OXLINT_CONFIG });
  },
  180_000,
);

test(
  "checks-graphwalk reads the kit's knip and dependency-cruiser builders, and neither config reads as unused",
  async () => {
    const walked = await bin("checks-graphwalk");
    expect(walked.text).toContain("no unreferenced files");
    expect(walked.text).toContain("no unused exports or types");
    expect(walked.text).toContain("cruised against dependency-cruiser.config.ts, no violation");
    expect(walked.exitCode).toBe(0);
  },
  180_000,
);

test(
  "checks-effect-scope writes the Effect paths of oxlint.config.ts into tsconfig.json, and its check fails once they drift",
  async () => {
    const stale = await bin("checks-effect-scope", ["--check"]);
    expect(stale.text).toContain("run checks-effect-scope to rewrite them");
    expect(stale.exitCode).toBe(1);

    expect((await bin("checks-effect-scope")).exitCode).toBe(0);
    const { compilerOptions } = await Bun.file(join(dir, "tsconfig.json")).json();
    const [kitService] = kitTsconfig.compilerOptions.plugins;
    expect(compilerOptions.plugins).toEqual([{ ...kitService, overrides: [{ include: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"], exclude: ["tests/**", "**/*.test.ts", "**/*.test.tsx"], options: severities }] }]);
    const fresh = await bin("checks-effect-scope", ["--check"]);
    expect(fresh.text).toContain("tsconfig.json holds the Effect paths of oxlint.config.ts");
    expect(fresh.exitCode).toBe(0);

    await put({ "oxlint.config.ts": OXLINT_CONFIG.replace("effect: true", "effect: false") });
    expect((await bin("checks-effect-scope", ["--check"])).exitCode).toBe(1);
    expect((await bin("checks-effect-scope")).exitCode).toBe(0);
    expect(await readFile(join(dir, "tsconfig.json"), "utf8")).not.toContain("overrides");
    await put({ "oxlint.config.ts": OXLINT_CONFIG });
  },
  180_000,
);

test(
  "oxlint and knip each refuse at load a config that leaves out what only the project knows, and pass once it is set",
  async () => {
    await put({ "oxlint.config.ts": OXLINT_CONFIG.replace("{ effect: true }", "{}"), "knip.config.ts": KNIP_CONFIG.replace('{ entry: ["src/index.ts"] }', "{}") });
    const oxlintRefused = await oxlint();
    expect(oxlintRefused.text).toContain("@avi2dg/checks/oxlint: set effect to true, false, or { files, excludeFiles }");
    expect(oxlintRefused.exitCode).not.toBe(0);
    const knipRefused = await bin("checks-graphwalk");
    expect(knipRefused.text).toContain("@avi2dg/checks/knip: set entry to the files nothing imports");
    expect(knipRefused.exitCode).toBe(2);

    await put({ "oxlint.config.ts": OXLINT_CONFIG, "knip.config.ts": KNIP_CONFIG });
    expect((await oxlint()).exitCode).toBe(0);
    expect((await bin("checks-graphwalk")).exitCode).toBe(0);
  },
  180_000,
);

test(
  "checks-frontend-syntax loads stylelint.config.ts through the installed kit and its peers: red on a hex colour outside the token file, green once it reads the token",
  async () => {
    const green = await bin("checks-frontend-syntax");
    expect(green.text).toBe("frontend-syntax: no violation in 2 file(s) from 1 declared input(s)\n");
    expect(green.exitCode).toBe(0);

    await put({ "src/site.css": "a {\n  color: #1c1d20;\n}\n" });
    const red = await bin("checks-frontend-syntax");
    expect(red.text).toBe('frontend-syntax: 1 problem(s) in 2 file(s) from 1 declared input(s):\n  src/site.css:2:10 Disallowed hex color "#1c1d20" (color-no-hex)\n');
    expect(red.exitCode).toBe(1);
    await put({ "src/site.css": TREE["src/site.css"] ?? "" });
  },
  180_000,
);

test(
  "tsc refuses each incomplete config through the installed types, and the consumer's own configs compile",
  async () => {
    await put(Object.fromEntries(Object.entries(REFUSED_TYPES).map(([file, [config]]) => [`types/${file}`, config])));
    await put({ "types/tsconfig.json": JSON.stringify({ extends: "../tsconfig.json", include: ["*.ts", "../*.config.ts"] }) });
    const typecheck = await bin("tsc", ["--noEmit", "--pretty", "false", "-p", "types/tsconfig.json"]);
    const refused = findings(typecheck.text, /^(?:types\/)?([\w.-]+)\(\d+,\d+\): error (TS\d+)/gm);
    expect(refused).toEqual(new Map(Object.entries(REFUSED_TYPES).map(([file, [, code]]) => [file, [code]])));
    await rm(join(dir, "types"), { recursive: true, force: true });
  },
  180_000,
);
