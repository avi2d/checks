import { $ } from "bun";
import { afterEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CHECKOUT = resolve(import.meta.dir, "..", "..");

let dir = "";
let packDir = "";

afterEach(async () => {
  for (const path of [dir, packDir]) {
    if (path !== "") {
      await rm(path, { recursive: true, force: true });
    }
  }
  dir = "";
  packDir = "";
});

async function packTarball(): Promise<string> {
  packDir = await mkdtemp(join(tmpdir(), "checks-pack-"));
  const packed = await $`bun pm pack --destination ${packDir} --quiet`.cwd(CHECKOUT).quiet();
  return packed.stdout.toString().trim();
}

async function oxlint(): Promise<{ exitCode: number; text: string }> {
  const binary = join(dir, "node_modules", ".bin", "oxlint");
  const result = await $`${binary} --type-aware`.cwd(dir).nothrow().quiet();
  return {
    exitCode: result.exitCode,
    text: result.stdout.toString() + result.stderr.toString(),
  };
}

async function writeConsumerFixture(
  manifest: Record<string, unknown> = {},
  checks = `file:${CHECKOUT}`,
): Promise<void> {
  dir = await mkdtemp(join(tmpdir(), "checks-consumer-"));

  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({
      name: "checks-consumer-fixture",
      type: "module",
      devDependencies: {
        "@avi2dg/checks": checks,
        effect: "4.0.0-rc.115",
        oxlint: "1.83.0",
        "@swc/core": "1.16.2",
      },
      ...manifest,
    }),
  );
  await writeFile(
    join(dir, ".oxlintrc.json"),
    JSON.stringify({
      extends: ["./node_modules/@avi2dg/checks/oxlintrc.json"],
      // oxlint's plugins do not inherit through extends, so the consumer restates them.
      plugins: ["typescript", "oxc", "eslint", "import"],
    }),
  );
  // oxlint honours .gitignore but not ignorePatterns for node_modules,
  // so the fixture carries the same node_modules/ entry a real consumer has.
  await writeFile(join(dir, ".gitignore"), "node_modules/\n");

  await $`bun install`.cwd(dir).quiet();
}

test(
  "file: consumer goes red on a planted Effect.ignore, green once it is removed",
  async () => {
    await writeConsumerFixture();
    await writeFile(
      join(dir, "plant.ts"),
      `import { Effect } from "effect";\n\nexport const program = Effect.ignore(Effect.fail("boom"));\n\nEffect.succeed(1);\n`,
    );

    const red = await oxlint();
    expect(red.exitCode).not.toBe(0);
    expect(red.text).toContain("plant.ts");
    expect(red.text).toContain("effect-channel(no-error-channel-escape)");

    await rm(join(dir, "plant.ts"));
    await writeFile(join(dir, "clean.ts"), `export const answer = 42;\n`);

    const green = await oxlint();
    expect(green.exitCode).toBe(0);
  },
  180_000,
);

test(
  "file: consumer lint stays green with a lint-dirty file inside the installed package",
  async () => {
    await writeConsumerFixture();
    await writeFile(join(dir, "clean.ts"), `export const answer = 42;\n`);
    await writeFile(
      join(dir, "node_modules", "@avi2dg", "checks", "effect-channel", "planted.ts"),
      `import { Effect } from "effect";\n\nexport const planted = Effect.ignore(Effect.fail("boom"));\n`,
    );

    const result = await oxlint();
    expect(result.exitCode).toBe(0);
  },
  180_000,
);

test(
  "the README lint recipe runs the installed layout check, red on a colocated test and green once it moves",
  async () => {
    await writeConsumerFixture({
      scripts: {
        test: "bun test --randomize",
        lint: "oxlint --type-aware && checks-lint-coverage && checks-test-layout",
      },
    });
    await writeFile(join(dir, "bunfig.toml"), await readFile(join(CHECKOUT, "bunfig.toml"), "utf8"));
    await writeFile(join(dir, "widget.ts"), "export const widget = 42;\n");
    await writeFile(
      join(dir, "widget.test.ts"),
      `import { expect, test } from "bun:test";\nimport { widget } from "./widget.ts";\ntest("widget", () => {\n  expect(widget).toBe(42);\n});\n`,
    );
    await $`git init -q && git add -A`.cwd(dir).quiet();

    const red = await $`bun run lint`.cwd(dir).nothrow().quiet();
    const redText = red.stdout.toString() + red.stderr.toString();
    expect(red.exitCode).not.toBe(0);
    expect(redText).toContain("widget.test.ts: a test file must live at tests/**/*.test.ts");
    expect(redText).toContain("move it to tests/widget.test.ts");

    await mkdir(join(dir, "tests"));
    await rename(join(dir, "widget.test.ts"), join(dir, "tests", "widget.test.ts"));
    await writeFile(
      join(dir, "tests", "widget.test.ts"),
      `import { expect, test } from "bun:test";\nimport { widget } from "../widget.ts";\ntest("widget", () => {\n  expect(widget).toBe(42);\n});\n`,
    );
    await $`git add -A`.cwd(dir).quiet();

    const green = await $`bun run lint`.cwd(dir).nothrow().quiet();
    const greenText = green.stdout.toString() + green.stderr.toString();
    expect(greenText).toContain("satisfy the layout");
    expect(green.exitCode).toBe(0);
  },
  180_000,
);

test(
  "packed-tarball consumer installs the files-limited surface and runs the README lint recipe from it",
  async () => {
    const tarball = await packTarball();
    await writeConsumerFixture(
      {
        scripts: {
          test: "bun test --randomize",
          lint: "oxlint --type-aware && checks-lint-coverage && checks-test-layout",
        },
      },
      `file:${tarball}`,
    );

    const installed = join(dir, "node_modules", "@avi2dg", "checks");
    const manifest = JSON.parse(await readFile(join(CHECKOUT, "package.json"), "utf8")) as {
      exports: Record<string, string>;
    };
    const targets = Object.values(manifest.exports);
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(existsSync(join(installed, target))).toBe(true);
    }
    expect(existsSync(join(installed, "LICENSE"))).toBe(true);
    expect(existsSync(join(installed, "effect-channel"))).toBe(false);
    expect(existsSync(join(installed, "tests"))).toBe(false);
    expect(existsSync(join(installed, "AGENTS.md"))).toBe(false);

    await writeFile(join(dir, "bunfig.toml"), await readFile(join(CHECKOUT, "bunfig.toml"), "utf8"));
    await writeFile(join(dir, "widget.ts"), "export const widget = 42;\n");
    await mkdir(join(dir, "tests"));
    await writeFile(
      join(dir, "tests", "widget.test.ts"),
      `import { expect, test } from "bun:test";\nimport { widget } from "../widget.ts";\ntest("widget", () => {\n  expect(widget).toBe(42);\n});\n`,
    );
    await $`git init -q && git add -A`.cwd(dir).quiet();

    const green = await $`bun run lint`.cwd(dir).nothrow().quiet();
    const greenText = green.stdout.toString() + green.stderr.toString();
    expect(greenText).toContain("satisfy the layout");
    expect(green.exitCode).toBe(0);

    await writeFile(
      join(dir, "plant.ts"),
      `import { Effect } from "effect";\n\nexport const program = Effect.ignore(Effect.fail("boom"));\n\nEffect.succeed(1);\n`,
    );
    await $`git add -A`.cwd(dir).quiet();

    const red = await $`bun run lint`.cwd(dir).nothrow().quiet();
    const redText = red.stdout.toString() + red.stderr.toString();
    expect(red.exitCode).not.toBe(0);
    expect(redText).toContain("plant.ts");
    expect(redText).toContain("effect-channel(no-error-channel-escape)");
  },
  180_000,
);

test(
  "packed-tarball consumer runs every bin by its short name from a package script",
  async () => {
    const tarball = await packTarball();
    await writeConsumerFixture(
      {
        scripts: {
          test: "bun test --randomize",
          lint: "oxlint --type-aware && checks-lint-coverage && checks-test-layout && checks-commit-identity HEAD",
          gate: "checks-comment-gate HEAD",
          backtest: "checks-backtest 5",
        },
      },
      `file:${tarball}`,
    );

    for (const bin of [
      "checks-lint-coverage",
      "checks-test-layout",
      "checks-commit-identity",
      "checks-comment-gate",
      "checks-backtest",
    ]) {
      expect(existsSync(join(dir, "node_modules", ".bin", bin))).toBe(true);
    }

    await writeFile(join(dir, "bunfig.toml"), await readFile(join(CHECKOUT, "bunfig.toml"), "utf8"));
    await writeFile(join(dir, "widget.ts"), "export const widget = 42;\n");
    await mkdir(join(dir, "tests"));
    await writeFile(
      join(dir, "tests", "widget.test.ts"),
      `import { expect, test } from "bun:test";\nimport { widget } from "../widget.ts";\ntest("widget", () => {\n  expect(widget).toBe(42);\n});\n`,
    );
    await $`git init -q && git add -A`.cwd(dir).quiet();
    await $`git -c user.name=avi2d -c user.email=avi2dg@gmail.com commit -qm "feat: base"`
      .cwd(dir)
      .quiet();
    await writeFile(join(dir, "clean.ts"), `export const answer = 42;\n`);
    await $`git add -A`.cwd(dir).quiet();
    await $`git -c user.name=avi2d -c user.email=avi2dg@gmail.com commit -qm "feat: second"`
      .cwd(dir)
      .quiet();

    const lint = await $`bun run lint`.cwd(dir).nothrow().quiet();
    const lintText = lint.stdout.toString() + lint.stderr.toString();
    expect(lintText).toContain("tracked .ts/.tsx files");
    expect(lintText).toContain("satisfy the layout");
    expect(lintText).toContain("carry only allowed identities");
    expect(lint.exitCode).toBe(0);

    const gate = await $`bun run gate`.cwd(dir).nothrow().quiet();
    const gateText = gate.stdout.toString() + gate.stderr.toString();
    expect(gateText).toContain("carry no refused comment");
    expect(gate.exitCode).toBe(0);

    const backtest = await $`bun run backtest`.cwd(dir).nothrow().quiet();
    const backtestText = backtest.stdout.toString() + backtest.stderr.toString();
    expect(backtestText).toContain("commits touching code");
    expect(backtest.exitCode).toBe(0);
  },
  180_000,
);
