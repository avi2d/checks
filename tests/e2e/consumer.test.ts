import { $ } from "bun";
import { afterEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Schema } from "effect";
import { withoutPullRequestEvent } from "../lib/env.ts";

const CHECKOUT = resolve(import.meta.dir, "..", "..");

const Manifest = Schema.fromJsonString(
  Schema.Struct({ exports: Schema.Record(Schema.String, Schema.String), bin: Schema.Record(Schema.String, Schema.String) }),
);

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
  "file: consumer that turns on no-throw and no-try-catch for src/ goes red on each, green once removed",
  async () => {
    await writeConsumerFixture();
    await writeFile(
      join(dir, ".oxlintrc.json"),
      JSON.stringify({
        extends: ["./node_modules/@avi2dg/checks/oxlintrc.json"],
        plugins: ["typescript", "oxc", "eslint", "import"],
        overrides: [
          {
            files: ["src/**"],
            rules: { "effect-channel/no-throw": "error", "effect-channel/no-try-catch": "error" },
          },
        ],
      }),
    );
    await mkdir(join(dir, "src"));
    await mkdir(join(dir, "scripts"));
    const load = join(dir, "src", "load.ts");

    await writeFile(
      load,
      `export const load = (text: string): unknown => {\n  if (text === "") throw new Error("empty manifest");\n  return JSON.parse(text);\n};\n`,
    );
    const thrown = await oxlint();
    expect(thrown.exitCode).not.toBe(0);
    expect(thrown.text).toContain("effect-channel(no-throw)");
    expect(thrown.text).toContain("Effect.fail");
    expect(thrown.text).not.toContain("effect-channel(no-try-catch)");

    await writeFile(
      load,
      `export const load = (text: string): unknown => {\n  try {\n    return JSON.parse(text);\n  } catch {\n    return null;\n  }\n};\n`,
    );
    const caught = await oxlint();
    expect(caught.exitCode).not.toBe(0);
    expect(caught.text).toContain("effect-channel(no-try-catch)");
    expect(caught.text).toContain("Effect.try");
    expect(caught.text).not.toContain("effect-channel(no-throw)");

    await writeFile(
      load,
      `import { Effect, Schema } from "effect";\n\nexport class InvalidManifest extends Schema.TaggedError<InvalidManifest>()("InvalidManifest", {\n  cause: Schema.Unknown,\n}) {}\n\nexport const load = (text: string): Effect.Effect<unknown, InvalidManifest> =>\n  Effect.try({ try: (): unknown => JSON.parse(text), catch: (cause) => new InvalidManifest({ cause }) });\n\nexport const settle = (release: () => void): void => {\n  try {\n    release();\n  } finally {\n    release();\n  }\n};\n`,
    );
    await writeFile(
      join(dir, "scripts", "edge.ts"),
      `export const edge = (text: string): unknown => {\n  try {\n    return JSON.parse(text);\n  } catch {\n    throw new Error("outside the override");\n  }\n};\n`,
    );
    const green = await oxlint();
    expect(green.text).not.toContain("effect-channel(no-throw)");
    expect(green.text).not.toContain("effect-channel(no-try-catch)");
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
  "a lint script calling checks-test-layout runs the installed layout check, red on a colocated test and green once it moves",
  async () => {
    await writeConsumerFixture({
      scripts: {
        test: "checks-test",
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
  "packed-tarball consumer installs the files-limited surface and lints with the installed plugin and layout check",
  async () => {
    const tarball = await packTarball();
    await writeConsumerFixture(
      {
        scripts: {
          test: "checks-test",
          lint: "oxlint --type-aware && checks-lint-coverage && checks-test-layout",
        },
      },
      `file:${tarball}`,
    );

    const installed = join(dir, "node_modules", "@avi2dg", "checks");
    const manifest = Schema.decodeSync(Manifest)(await readFile(join(CHECKOUT, "package.json"), "utf8"));
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
          test: "checks-test",
          lint: "oxlint --type-aware && checks-lint-coverage && checks-test-layout && checks-commit-identity HEAD",
          gate: "checks-comment-gate HEAD",
          ratchet: "checks-suppressions-ratchet HEAD",
          backtest: "checks-backtest 5",
          compare: "checks-mutation-compare mutation.json mutation.json",
          wiring: "checks-ci-wiring",
          flake: "checks-flake --runs 2",
          quality: "checks-quality --check",
          kit: "oxlint --type-aware && checks-lint",
        },
      },
      `file:${tarball}`,
    );
    await writeFile(join(dir, "quality.json"), JSON.stringify({ gates: { ci: ["bun run lint"] } }));

    const manifest = Schema.decodeSync(Manifest)(await readFile(join(CHECKOUT, "package.json"), "utf8"));
    const bins = Object.keys(manifest.bin);
    expect(bins).toContain("checks-ci-wiring");
    for (const bin of bins) {
      expect(existsSync(join(dir, "node_modules", ".bin", bin))).toBe(true);
    }

    await writeFile(
      join(dir, "mutation.json"),
      await readFile(join(CHECKOUT, "tests", "fixtures", "mutation-compare", "base.json"), "utf8"),
    );
    await mkdir(join(dir, ".github", "workflows"), { recursive: true });
    await writeFile(
      join(dir, ".github", "workflows", "ci.yml"),
      "on: pull_request\njobs:\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - run: bun run lint\n",
    );

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

    const compare = await $`bun run compare`.cwd(dir).nothrow().quiet();
    expect(compare.stdout.toString()).toContain("no regression");
    expect(compare.exitCode).toBe(0);

    const suite = await $`bun run test`.cwd(dir).nothrow().quiet();
    expect(suite.stderr.toString()).toContain(" 1 pass");
    expect(suite.stdout.toString()).toContain("checks-test: no test skipped");
    expect(suite.exitCode).toBe(0);

    const { GITHUB_STEP_SUMMARY: _summary, ...withoutStepSummary } = process.env;
    const flake = await $`bun run flake`.cwd(dir).env(withoutStepSummary).nothrow().quiet();
    expect(flake.stdout.toString()).toContain("checks-flake: 2 run(s) passed, with seeds ");
    expect(flake.exitCode).toBe(0);

    const wiring = await $`bun run wiring`.cwd(dir).nothrow().quiet();
    expect(wiring.stdout.toString()).toContain("1 gate(s) run on pull requests to main");
    expect(wiring.exitCode).toBe(0);

    const quality = await $`bun run quality`.cwd(dir).nothrow().quiet();
    expect(quality.stdout.toString()).toContain("checks-quality: no sources.effect is declared, so nothing is generated");
    expect(quality.exitCode).toBe(0);

    const ratchet = await $`bun run ratchet`.cwd(dir).nothrow().quiet();
    expect(ratchet.stdout.toString()).toContain("no count in oxlint-suppressions.json rose or appeared");
    expect(ratchet.exitCode).toBe(0);

    await $`git update-ref refs/remotes/origin/main HEAD~1`.cwd(dir).quiet();
    const kit = await $`bun run kit`.cwd(dir).env(withoutPullRequestEvent()).nothrow().quiet();
    const kitText = kit.stdout.toString() + kit.stderr.toString();
    expect(kitText).toContain("from HEAD against origin/main");
    expect(kitText).toContain("commit-identity: 1 commit(s)");
    expect(kitText).toContain("checks-lint: 7 gate(s) pass");
    expect(kit.exitCode).toBe(0);
  },
  180_000,
);

test(
  "packed-tarball consumer generates the quality fragments with the installed bin, and they hold its Effect paths",
  async () => {
    const tarball = await packTarball();
    await writeConsumerFixture({ scripts: { generate: "checks-quality generate" } }, `file:${tarball}`);
    await writeFile(
      join(dir, "quality.json"),
      JSON.stringify({
        $schema: "./node_modules/@avi2dg/checks/quality.schema.json",
        sources: { effect: { paths: ["src/**/*.ts"] } },
      }),
    );
    await writeFile(
      join(dir, ".oxlintrc.json"),
      JSON.stringify({
        extends: ["./node_modules/@avi2dg/checks/oxlintrc.json", "./oxlintrc.quality.json"],
        plugins: ["typescript", "oxc", "eslint", "import"],
      }),
    );
    await writeFile(
      join(dir, "tsconfig.json"),
      JSON.stringify({ extends: ["@avi2dg/checks/tsconfig.effect.json", "./tsconfig.quality.json"], include: ["src/**/*.ts"] }),
    );
    await mkdir(join(dir, "src"));
    await writeFile(join(dir, "src", "load.ts"), "export const load = (text: string): string => text;\n");
    await writeFile(join(dir, "edge.ts"), `export function edge(): never {\n  throw new Error("outside the declared paths");\n}\n`);
    await $`git init -q`.cwd(dir).quiet();

    const generated = await $`bun run generate`.cwd(dir).nothrow().quiet();
    expect(generated.stdout.toString()).toContain("checks-quality: oxlintrc.quality.json and tsconfig.quality.json hold what quality.json declares");
    expect(generated.exitCode).toBe(0);
    expect((await oxlint()).exitCode).toBe(0);

    await writeFile(join(dir, "src", "load.ts"), `export function load(): never {\n  throw new Error("inside them");\n}\n`);
    const red = await oxlint();
    expect(red.text).toContain("effect-channel(no-throw)");
    expect(red.text).toContain("src/load.ts");
    expect(red.text).not.toContain("edge.ts");
    expect(red.exitCode).not.toBe(0);
  },
  180_000,
);
