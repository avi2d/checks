import { $ } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Schema } from "effect";
import { withoutPullRequestEvent } from "../lib/env.ts";
import { CHECKOUT, ran, UNVENDORED_BUNFIG, type Ran } from "./lib/fixture-repo.ts";

const WIDGET = "export const widget = 42;\n";

const Manifest = Schema.fromJsonString(
  Schema.Struct({ exports: Schema.Record(Schema.String, Schema.String), bin: Schema.Record(Schema.String, Schema.String) }),
);

type Output = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly text: string;
};

type Kind = "file" | "tarball";

// Every dependency and its version are the same across every fixture, so one
// `bun install` per kind serves every test that uses it.
const KEPT_ACROSS_TESTS = new Set(["node_modules", "bun.lock"]);

let dir = "";
let fileDir = "";
let tarballDir = "";
let tarballPath = "";
let packDir = "";

function widgetTest(widget: string): string {
  return `import { expect, test } from "bun:test";\nimport { widget } from "${widget}";\ntest("widget", () => {\n  expect(widget).toBe(42);\n});\n`;
}

function manifestFor(checks: string): Record<string, unknown> {
  return {
    name: "checks-consumer-fixture",
    type: "module",
    devDependencies: {
      "@avi2dg/checks": checks,
      effect: "4.0.0-rc.115",
      oxlint: "1.83.0",
      "@swc/core": "1.16.2",
    },
  };
}

async function installConsumer(installDir: string, checks: string): Promise<void> {
  await writeFile(join(installDir, "package.json"), JSON.stringify(manifestFor(checks)));
  await $`bun install`.cwd(installDir).quiet();
}

async function resetWorkspace(workDir: string): Promise<void> {
  for (const entry of await readdir(workDir)) {
    if (KEPT_ACROSS_TESTS.has(entry)) continue;
    await rm(join(workDir, entry), { recursive: true, force: true });
  }
}

beforeAll(async () => {
  fileDir = await mkdtemp(join(tmpdir(), "checks-consumer-file-"));
  await installConsumer(fileDir, `file:${CHECKOUT}`);

  packDir = await mkdtemp(join(tmpdir(), "checks-pack-"));
  const packed = await $`bun pm pack --destination ${packDir} --quiet --ignore-scripts`.cwd(CHECKOUT).quiet();
  tarballPath = packed.stdout.toString().trim();

  tarballDir = await mkdtemp(join(tmpdir(), "checks-consumer-tarball-"));
  await installConsumer(tarballDir, `file:${tarballPath}`);
}, 360_000);

afterAll(async () => {
  for (const one of [fileDir, tarballDir, packDir]) if (one) await rm(one, { recursive: true, force: true });
}, 60_000);

function oxlint(): Promise<Ran> {
  const binary = join(dir, "node_modules", ".bin", "oxlint");
  return ran($`${binary} --type-aware`.cwd(dir));
}

async function useConsumer(kind: Kind, manifest: Record<string, unknown> = {}): Promise<void> {
  dir = kind === "file" ? fileDir : tarballDir;
  await resetWorkspace(dir);
  const checks = kind === "file" ? `file:${CHECKOUT}` : `file:${tarballPath}`;
  await writeFile(join(dir, "package.json"), JSON.stringify({ ...manifestFor(checks), ...manifest }));
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
}

async function writeWidgetRepo(testFile: string, widget: string): Promise<void> {
  await writeFile(join(dir, "bunfig.toml"), UNVENDORED_BUNFIG);
  await writeFile(join(dir, "widget.ts"), WIDGET);
  await mkdir(dirname(join(dir, testFile)), { recursive: true });
  await writeFile(join(dir, testFile), widgetTest(widget));
  await $`git init -q && git add -A`.cwd(dir).quiet();
}

async function commitAll(message: string): Promise<void> {
  await $`git add -A && git -c user.name=avi2d -c user.email=avi2dg@gmail.com commit -qm ${message}`.cwd(dir).quiet();
}

async function runScript(script: string, env?: Readonly<Record<string, string | undefined>>): Promise<Output> {
  const shell = $`bun run ${script}`.cwd(dir);
  const result = await (env === undefined ? shell : shell.env(env)).nothrow().quiet();
  const stdout = result.stdout.toString();
  const stderr = result.stderr.toString();
  return { exitCode: result.exitCode, stdout, stderr, text: stdout + stderr };
}

test(
  "file: consumer goes red on a planted Effect.ignore, green once it is removed",
  async () => {
    await useConsumer("file");
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
    await useConsumer("file");
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

const TANGLED_SETTLE = `export function settle(order) {
  if (order !== null) {
    if (order.paid || order.credit) {
      for (const line of order.lines) {
        if (line.taxable && line.shipped || line.gift) {
          charge(line);
        } else if (line.refunded || line.voided) {
          refund(line);
        } else {
          skip(line);
        }
      }
      return "settled";
    }
    return "unpaid";
  }
  return "missing";
}
`;

const FLAT_SETTLE = `export function settle(order) {
  if (order === null) return "missing";
  if (!order.paid) return "unpaid";
  for (const line of order.lines) {
    if (line.taxable) charge(line);
  }
  return "settled";
}
`;

test(
  "file: consumer goes red on a tangled function under cognitive-complexity, green once it is flattened",
  async () => {
    await useConsumer("file");
    await writeFile(
      join(dir, ".oxlintrc.json"),
      JSON.stringify({
        extends: ["./node_modules/@avi2dg/checks/oxlintrc.json"],
        plugins: ["typescript", "oxc", "eslint", "import"],
        rules: { "effect-channel/cognitive-complexity": ["error", { max: 15 }] },
      }),
    );
    await writeFile(join(dir, "settle.js"), TANGLED_SETTLE);

    const red = await oxlint();
    expect(red.exitCode).not.toBe(0);
    expect(red.text).toContain("settle.js");
    expect(red.text).toContain("effect-channel(cognitive-complexity)");
    expect(red.text).toContain("has a cognitive complexity of 16. Maximum allowed is 15.");

    await writeFile(join(dir, "settle.js"), FLAT_SETTLE);
    const green = await oxlint();
    expect(green.exitCode).toBe(0);
  },
  180_000,
);

test(
  "file: consumer lint stays green with a lint-dirty file inside the installed package",
  async () => {
    await useConsumer("file");
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
  "file: consumer goes red on a call to a function tagged @deprecated, green once it calls the replacement",
  async () => {
    await useConsumer("file");
    await writeFile(
      join(dir, "legacy.ts"),
      `/** @deprecated Call fresh instead. */\nexport const stale = (): number => 1;\n\nexport const fresh = (): number => 2;\n`,
    );
    await writeFile(join(dir, "caller.ts"), `import { stale } from "./legacy";\n\nexport const value = stale();\n`);

    const red = await oxlint();
    expect(red.exitCode).not.toBe(0);
    expect(red.text).toContain("typescript(no-deprecated)");
    expect(red.text).toContain("caller.ts");

    await writeFile(join(dir, "caller.ts"), `import { fresh } from "./legacy";\n\nexport const value = fresh();\n`);
    const green = await oxlint();
    expect(green.exitCode).toBe(0);
  },
  180_000,
);

test(
  "a lint script calling checks-test-layout runs the installed layout check, red on a colocated test and green once it moves",
  async () => {
    await useConsumer("file", {
      scripts: {
        test: "checks-test",
        lint: "oxlint --type-aware && checks-lint-coverage && checks-test-layout",
      },
    });
    await writeWidgetRepo("widget.test.ts", "./widget.ts");

    const red = await runScript("lint");
    expect(red.exitCode).not.toBe(0);
    expect(red.text).toContain("widget.test.ts: a test file must live at tests/**/*.test.ts");
    expect(red.text).toContain("move it to tests/widget.test.ts");

    await mkdir(join(dir, "tests"));
    await rename(join(dir, "widget.test.ts"), join(dir, "tests", "widget.test.ts"));
    await writeFile(join(dir, "tests", "widget.test.ts"), widgetTest("../widget.ts"));
    await $`git add -A`.cwd(dir).quiet();

    const green = await runScript("lint");
    expect(green.text).toContain("satisfy the layout");
    expect(green.exitCode).toBe(0);
  },
  180_000,
);

test(
  "packed-tarball consumer installs the files-limited surface and lints with the installed plugin and layout check",
  async () => {
    await useConsumer("tarball", {
      scripts: {
        test: "checks-test",
        lint: "oxlint --type-aware && checks-lint-coverage && checks-test-layout",
      },
    });

    const installed = join(dir, "node_modules", "@avi2dg", "checks");
    const manifest = Schema.decodeSync(Manifest)(await readFile(join(CHECKOUT, "package.json"), "utf8"));
    const targets = Object.values(manifest.exports);
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(existsSync(join(installed, target))).toBe(true);
    }
    expect(existsSync(join(installed, "LICENSE"))).toBe(true);
    expect(existsSync(join(installed, "CHANGELOG.md"))).toBe(true);
    expect(existsSync(join(installed, "effect-channel"))).toBe(false);
    expect(existsSync(join(installed, "tests"))).toBe(false);
    expect(existsSync(join(installed, "AGENTS.md"))).toBe(false);

    await writeWidgetRepo("tests/widget.test.ts", "../widget.ts");

    const green = await runScript("lint");
    expect(green.text).toContain("satisfy the layout");
    expect(green.exitCode).toBe(0);

    await writeFile(
      join(dir, "plant.ts"),
      `import { Effect } from "effect";\n\nexport const program = Effect.ignore(Effect.fail("boom"));\n\nEffect.succeed(1);\n`,
    );
    await $`git add -A`.cwd(dir).quiet();

    const red = await runScript("lint");
    expect(red.exitCode).not.toBe(0);
    expect(red.text).toContain("plant.ts");
    expect(red.text).toContain("effect-channel(no-error-channel-escape)");
  },
  180_000,
);

test(
  "packed-tarball consumer runs every bin by its short name from a package script",
  async () => {
    await useConsumer("tarball", {
      scripts: {
        test: "checks-test",
        lint: "oxlint --type-aware && checks-lint-coverage && checks-test-layout && checks-commit-identity HEAD",
        gate: "checks-comment-gate HEAD",
        ratchet: "checks-suppressions-ratchet HEAD",
        clock: "checks-quarantine-clock HEAD",
        backtest: "checks-backtest 5",
        compare: "checks-mutation-compare mutation.json mutation.json",
        wiring: "checks-ci-wiring",
        flake: "checks-flake --runs 2",
        generate: "checks-quality generate",
        quality: "checks-quality --check",
        size: "checks-size-budget HEAD",
        repetition: "checks-repetition HEAD",
        owners: "checks-feature-owners HEAD",
        docs: "checks-docs HEAD",
        kit: "oxlint --type-aware && checks-lint",
      },
    });
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

    await writeWidgetRepo("tests/widget.test.ts", "../widget.ts");
    await commitAll("feat: base");
    await writeFile(join(dir, "clean.ts"), `export const answer = 42;\n`);
    await commitAll("feat: second");

    const generated = await runScript("generate");
    expect(generated.stdout).toContain("checks-quality: wrote .github/workflows/ci.yml");
    expect(generated.stdout).toContain("checks-quality: wrote .github/workflows/commitlint.yml");
    expect(generated.exitCode).toBe(0);

    const lint = await runScript("lint");
    expect(lint.text).toContain("tracked .ts/.tsx files");
    expect(lint.text).toContain("satisfy the layout");
    expect(lint.text).toContain("carry only allowed identities");
    expect(lint.exitCode).toBe(0);

    const gate = await runScript("gate");
    expect(gate.text).toContain("carry no refused comment");
    expect(gate.exitCode).toBe(0);

    const backtest = await runScript("backtest");
    expect(backtest.text).toContain("commits touching code");
    expect(backtest.exitCode).toBe(0);

    const compare = await runScript("compare");
    expect(compare.stdout).toContain("no regression");
    expect(compare.exitCode).toBe(0);

    const suite = await runScript("test");
    expect(suite.stderr).toContain(" 1 pass");
    expect(suite.stdout).toContain("checks-test: no test skipped");
    expect(suite.exitCode).toBe(0);

    const { GITHUB_STEP_SUMMARY: _summary, ...withoutStepSummary } = process.env;
    const flake = await runScript("flake", withoutStepSummary);
    expect(flake.stdout).toContain("checks-flake: 2 run(s) passed, with seeds ");
    expect(flake.exitCode).toBe(0);

    for (const [script, report] of [
      ["wiring", "1 gate(s) run on pull requests to main"],
      ["quality", "checks-quality: no sources.effect is declared, so no fragment is generated; .github/workflows/ci.yml and .github/workflows/commitlint.yml hold the kit recipe"],
      ["size", "size-budget: quality.json declares no size budget"],
      ["repetition", "repetition: quality.json declares no sources.production"],
      ["owners", "feature-owners: quality.json declares no feature"],
      ["docs", "docs: 0 doc file(s) the range touches hold to their templates"],
      ["ratchet", "no count in oxlint-suppressions.json rose or appeared"],
      ["clock", "no test in tests/quarantine/ is past 30 days"],
    ] as const) {
      const guardrail = await runScript(script);
      expect(guardrail.stdout).toContain(report);
      expect(guardrail.exitCode).toBe(0);
    }

    await $`git update-ref refs/remotes/origin/main HEAD~1`.cwd(dir).quiet();
    const kit = await runScript("kit", withoutPullRequestEvent());
    expect(kit.text).toContain("from HEAD against origin/main");
    expect(kit.text).toContain("commit-identity: 1 commit(s)");
    expect(kit.text).toContain("checks-lint: 12 gate(s) pass");
    expect(kit.exitCode).toBe(0);
  },
  180_000,
);

test(
  "packed-tarball consumer generates the quality fragments with the installed bin, and they hold its Effect paths",
  async () => {
    await useConsumer("tarball", { scripts: { generate: "checks-quality generate" } });
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
    expect(generated.stdout.toString()).toContain("checks-quality: oxlintrc.quality.json and tsconfig.quality.json and .github/workflows/commitlint.yml hold what quality.json declares");
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
