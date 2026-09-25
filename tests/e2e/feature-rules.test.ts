import { $ } from "bun";
import { expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { globPattern } from "../../scripts/feature-rules.ts";
import { CHECKOUT, ran, scratchDirs, type Ran } from "./lib/fixture-repo.ts";

const BILLING = {
  name: "billing",
  root: "src/billing",
  entries: ["src/billing/index.ts"],
  allowFrom: ["src/cli/*.ts"],
  proof: "tests/e2e/billing.test.ts",
};

const scratch = scratchDirs();

let dir = "";

async function write(files: Readonly<Record<string, string>>): Promise<void> {
  for (const [name, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, name)), { recursive: true });
    await writeFile(join(dir, name), content);
  }
}

function config(kit: string): string {
  return [
    `const { featureRules } = require(${JSON.stringify(`${kit}/dist/feature-rules.js`)});`,
    "",
    "module.exports = {",
    `  extends: ${JSON.stringify(`${kit}/dependency-cruiser.config.js`)},`,
    `  forbidden: [...featureRules(require("./quality.json"))],`,
    "};",
    "",
  ].join("\n");
}

async function billingProject(kit: string): Promise<void> {
  await write({
    "quality.json": JSON.stringify({ features: [BILLING] }),
    ".dependency-cruiser.cjs": config(kit),
    "src/billing/index.ts": `export { charge } from "./charge.ts";\n`,
    "src/billing/charge.ts": "export const charge = 1;\n",
    "src/cli/run.ts": `import { charge } from "../billing/charge.ts";\n\nexport const run = charge;\n`,
    "tests/billing.test.ts": `import { charge } from "../src/billing/charge.ts";\n\nexport const probe = charge;\n`,
    "src/main.ts": `import { charge } from "./billing/charge.ts";\n\nexport const main = charge;\n`,
  });
}

function depcruise(binary: string): Promise<Ran> {
  return ran($`${binary} --config .dependency-cruiser.cjs src tests`.cwd(dir));
}

async function importTheEntry(binary: string): Promise<void> {
  await write({ "src/main.ts": `import { charge } from "./billing/index.ts";\n\nexport const main = charge;\n` });
  const green = await depcruise(binary);
  expect(green.text).toContain("no dependency violations found");
  expect(green.exitCode).toBe(0);
}

test(
  "a deep import into a feature from outside it goes red naming the rule, green once it imports the entry",
  async () => {
    dir = await scratch("checks-feature-rules-");
    await write({ "package.json": JSON.stringify({ name: "checks-feature-rules-fixture", type: "module" }) });
    await billingProject(CHECKOUT);
    const binary = join(CHECKOUT, "node_modules", ".bin", "depcruise");

    const red = await depcruise(binary);
    expect(red.text).toContain("error feature-billing-entries: src/main.ts → src/billing/charge.ts");
    expect(red.text).toContain("1 dependency violations (1 errors, 0 warnings)");
    expect(red.exitCode).not.toBe(0);

    await importTheEntry(binary);

    await write({ "quality.json": JSON.stringify({ features: [{ ...BILLING, root: "src/billing/" }] }) });
    const malformed = await depcruise(binary);
    expect(malformed.text).toContain("Expected a directory from the repository root");
    expect(malformed.exitCode).not.toBe(0);
  },
  60_000,
);

test("an allowFrom glob admits the files git's glob pathspec matches, and no other", async () => {
  dir = await scratch("checks-feature-globs-");
  const files = [
    "a.ts",
    "src/a.ts",
    "src/a.tsx",
    "src/cli/run.ts",
    "src/cli/deep/run.ts",
    "src/clix/run.ts",
    "src/a.b/c.ts",
    "srcx/a.ts",
    "tests/e2e/x.test.ts",
    "tests/e2e/lib/y.test.ts",
    "packages/@scope/x/src/i.ts",
  ];
  await write(Object.fromEntries(files.map((file) => [file, ""])));
  await $`git init -q && git add -A`.cwd(dir).quiet();
  for (const glob of ["src/**/*.ts", "**/*.ts", "src/cli/*.ts", "src/*/run.ts", "tests/**/*.test.ts", "src/a.b/*.ts", "packages/@scope/x/**/*.ts", "src/c*/*.ts"]) {
    const listed = (await $`git ls-files -- ${`:(glob)${glob}`}`.cwd(dir).quiet()).stdout.toString().split("\n").filter(Boolean);
    const pattern = new RegExp(globPattern(glob));
    expect({ glob, matched: files.filter((file) => pattern.test(file)).toSorted() }).toEqual({ glob, matched: listed.toSorted() });
  }
});

test(
  "a packed-tarball consumer spreads the installed helper into its own config and goes red, then green",
  async () => {
    const packDir = await scratch("checks-pack-");
    const packed = (await $`bun pm pack --destination ${packDir} --quiet`.cwd(CHECKOUT).quiet()).stdout.toString().trim().split("\n");
    const tarball = packed[packed.length - 1] ?? "";
    dir = await scratch("checks-feature-consumer-");
    await write({
      "package.json": JSON.stringify({
        name: "checks-feature-consumer",
        type: "module",
        devDependencies: {
          "@avi2dg/checks": `file:${tarball}`,
          "dependency-cruiser": "18.4.0",
          effect: "4.0.0-rc.115",
        },
      }),
    });
    await $`bun install`.cwd(dir).quiet();
    await billingProject("./node_modules/@avi2dg/checks");
    await write({
      ".dependency-cruiser.cjs": [
        `const { featureRules } = require("@avi2dg/checks/dist/feature-rules.js");`,
        "",
        "module.exports = {",
        `  extends: "./node_modules/@avi2dg/checks/dependency-cruiser.config.js",`,
        `  forbidden: [...featureRules(require("./quality.json"))],`,
        "};",
        "",
      ].join("\n"),
    });
    const binary = join(dir, "node_modules", ".bin", "depcruise");

    const red = await depcruise(binary);
    expect(red.text).toContain("error feature-billing-entries: src/main.ts → src/billing/charge.ts");
    expect(red.exitCode).not.toBe(0);

    await importTheEntry(binary);
  },
  180_000,
);
