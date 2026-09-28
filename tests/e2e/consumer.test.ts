import { $ } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Schema } from "effect";
import { withoutPullRequestEvent } from "../lib/env.ts";
import { CHECKOUT, ran, UNVENDORED_BUNFIG, type Ran } from "./lib/fixture-repo.ts";
import { installConsumer, manifestFor, resetWorkspace, widgetTest } from "./lib/installed-consumer.ts";

const WIDGET = "export const widget = 42;\n";

const Manifest = Schema.fromJsonString(
  Schema.Struct({
    name: Schema.String,
    exports: Schema.Record(Schema.String, Schema.String),
    bin: Schema.Record(Schema.String, Schema.String),
  }),
);

const OxlintPlugins = Schema.fromJsonString(Schema.Struct({ jsPlugins: Schema.Array(Schema.String) }));

type Output = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly text: string;
};

type Kind = "file" | "tarball";

let dir = "";
let fileDir = "";
let tarballDir = "";
let tarballPath = "";
let packDir = "";

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
  await writeOxlintrc();
  // oxlint honours .gitignore but not ignorePatterns for node_modules,
  // so the fixture carries the same node_modules/ entry a real consumer has.
  await writeFile(join(dir, ".gitignore"), "node_modules/\n");
}

async function writeOxlintrc(own: Readonly<Record<string, unknown>> = {}): Promise<void> {
  await writeFile(
    join(dir, ".oxlintrc.json"),
    JSON.stringify({
      extends: ["./node_modules/@avi2dg/checks/oxlintrc.json"],
      // oxlint's plugins do not inherit through extends, so the consumer restates them.
      plugins: ["typescript", "oxc", "eslint", "import"],
      ...own,
    }),
  );
}

async function writeWidgetRepo(testFile: string, widget: string): Promise<void> {
  await writeFile(join(dir, "bunfig.toml"), UNVENDORED_BUNFIG);
  const compilerOptions = { module: "preserve", moduleResolution: "bundler", allowImportingTsExtensions: true, noEmit: true, strict: true, types: ["bun"] };
  await writeFile(join(dir, "tsconfig.json"), JSON.stringify({ extends: "@avi2dg/checks/tsconfig.effect.json", compilerOptions }));
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
    await writeFile(join(dir, "plant.ts"), `import { Effect } from "effect";\n\nexport const program = Effect.ignore(Effect.fail("boom"));\n\nEffect.succeed(1);\n`);

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
    await writeOxlintrc({
      overrides: [{ files: ["src/**"], rules: { "effect-channel/no-throw": "error", "effect-channel/no-try-catch": "error" } }],
    });
    await mkdir(join(dir, "src"));
    await mkdir(join(dir, "scripts"));
    const load = join(dir, "src", "load.ts");

    await writeFile(load, `export const load = (text: string): unknown => {\n  if (text === "") throw new Error("empty manifest");\n  return JSON.parse(text);\n};\n`);
    const thrown = await oxlint();
    expect(thrown.exitCode).not.toBe(0);
    expect(thrown.text).toContain("effect-channel(no-throw)");
    expect(thrown.text).toContain("Effect.fail");
    expect(thrown.text).not.toContain("effect-channel(no-try-catch)");

    await writeFile(load, `export const load = (text: string): unknown => {\n  try {\n    return JSON.parse(text);\n  } catch {\n    return null;\n  }\n};\n`);
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
    await writeOxlintrc({ rules: { "readability/cognitive-complexity": ["error", { max: 15 }] } });
    await writeFile(join(dir, "settle.js"), TANGLED_SETTLE);

    const red = await oxlint();
    expect(red.exitCode).not.toBe(0);
    expect(red.text).toContain("settle.js");
    expect(red.text).toContain("readability(cognitive-complexity)");
    expect(red.text).toContain("has a cognitive complexity of 16. Maximum allowed is 15.");

    await writeFile(join(dir, "settle.js"), FLAT_SETTLE);
    const green = await oxlint();
    expect(green.exitCode).toBe(0);
  },
  180_000,
);

test(
  "file: consumer goes red on a mutable collection parameter and a schema twin, green once each is fixed",
  async () => {
    await useConsumer("file");
    await writeFile(join(dir, "totals.ts"), `export function total(items: string[]): number {\n  return items.length;\n}\n`);
    await writeFile(join(dir, "status.ts"), `import { Schema } from "effect";\nexport type Status = { readonly code: string; readonly count: number };\nexport const StatusSchema = Schema.Struct({ code: Schema.String, count: Schema.Number });\n`);
    await mkdir(join(dir, "tests"));
    await writeFile(join(dir, "tests", "oracle.ts"), `import { Schema } from "effect";\nexport type Oracle = { readonly code: string; readonly count: number };\nexport const OracleSchema = Schema.Struct({ code: Schema.String, count: Schema.Number });\n`);
    const red = await oxlint();
    expect(red.text).toContain("data-shape(readonly-collection-param)");
    expect(red.text).toContain("data-shape(schema-twin)");
    expect(red.text).not.toContain("oracle.ts");
    await writeFile(join(dir, "totals.ts"), `export function total(items: readonly string[]): number {\n  return items.length;\n}\n`);
    await writeFile(join(dir, "status.ts"), `import { Schema } from "effect";\nexport const StatusSchema = Schema.Struct({ code: Schema.String, count: Schema.Number });\nexport type Status = typeof StatusSchema.Type;\n`);
    expect((await oxlint()).exitCode).toBe(0);
  },
  180_000,
);

test(
  "file: consumer lint stays green with a lint-dirty file inside the installed package",
  async () => {
    await useConsumer("file");
    await writeFile(join(dir, "clean.ts"), `export const answer = 42;\n`);
    await writeFile(
      join(dir, "node_modules", "@avi2dg", "checks", "src", "quality", "effect-channel", "planted.ts"),
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
    await writeFile(join(dir, "legacy.ts"), `/** @deprecated Call fresh instead. */\nexport const stale = (): number => 1;\n\nexport const fresh = (): number => 2;\n`);
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

const ANY_LEAK = `export function firstName(text: string): string {\n  const parsed = JSON.parse(text);\n  return parsed.name;\n}\n`;

test(
  "file: consumer goes red on an any leak in production under no-unsafe-*, silent on the same leak in tests/",
  async () => {
    await useConsumer("file");
    await writeFile(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true }, include: ["src", "tests"] }));
    await mkdir(join(dir, "src"));
    await mkdir(join(dir, "tests", "unit"), { recursive: true });
    await writeFile(join(dir, "src", "names.ts"), ANY_LEAK);
    await writeFile(join(dir, "tests", "unit", "names.test.ts"), ANY_LEAK);

    const red = await oxlint();
    expect(red.exitCode).not.toBe(0);
    for (const rule of ["no-unsafe-assignment", "no-unsafe-member-access", "no-unsafe-return"]) expect(red.text).toContain(`typescript(${rule})`);
    expect(red.text).toContain("src/names.ts");
    expect(red.text).not.toContain("names.test.ts");

    await writeFile(
      join(dir, "src", "names.ts"),
      `export function firstName(text: string): unknown {\n  const parsed: unknown = JSON.parse(text);\n  return typeof parsed === "object" && parsed !== null && "name" in parsed ? parsed.name : undefined;\n}\n`,
    );
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
    expect(red.text).toContain("widget.test.ts: a test file must live at tests/<level>/**/*.test.ts");
    expect(red.text).toContain("move it to tests/unit/widget.test.ts");

    await mkdir(join(dir, "tests", "unit"), { recursive: true });
    await rename(join(dir, "widget.test.ts"), join(dir, "tests", "unit", "widget.test.ts"));
    await writeFile(join(dir, "tests", "unit", "widget.test.ts"), widgetTest("../../widget.ts"));
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
    expect(Object.keys(manifest.exports).toSorted()).toEqual([
      "./dependency-cruiser.config.js",
      "./knip-base.json",
      "./scripts/comment-matchers.ts",
      "./scripts/prose-matchers.ts",
      "./scripts/test-skips.ts",
      "./stryker.preset.js",
      "./templates/*",
      "./tsconfig.effect.json",
    ]);
    const resolved = Object.entries(manifest.exports).map(([key, target]) => {
      const specifier = key.endsWith("/*") ? `${manifest.name}${key.slice(1, -1)}readme.md` : `${manifest.name}${key.slice(1)}`;
      const file = target.endsWith("/*") ? join(installed, target.slice(0, -1).concat("readme.md")) : join(installed, target);
      return [key, realpathSync(Bun.resolveSync(specifier, dir)) === realpathSync(file)];
    });
    expect(resolved.filter(([, found]) => !found)).toEqual([]);
    const shipped = ["ts-reset.d.ts", "dist/templates/readme.md", "src/quality/presets/effect.oxlint.json", "LICENSE", "CHANGELOG.md", "knip-base.json", "dist/data-shape/index.js"];
    const unshipped = ["templates", "presets", "src/quality/effect-channel", "src/complexity/readability", "src/quality/data-shape", "tests", "AGENTS.md"];
    expect(shipped.filter((path) => !existsSync(join(installed, path)))).toEqual([]);
    expect(unshipped.filter((path) => existsSync(join(installed, path)))).toEqual([]);

    await writeWidgetRepo("tests/unit/widget.test.ts", "../../widget.ts");

    const green = await runScript("lint");
    expect(green.text).toContain("satisfy the layout");
    expect(green.exitCode).toBe(0);

    await writeFile(join(dir, "plant.ts"), `import { Effect } from "effect";\n\nexport const program = Effect.ignore(Effect.fail("boom"));\n\nEffect.succeed(1);\n`);
    await $`git add -A`.cwd(dir).quiet();

    const red = await runScript("lint");
    expect(red.exitCode).not.toBe(0);
    expect(red.text).toContain("plant.ts");
    expect(red.text).toContain("effect-channel(no-error-channel-escape)");
  },
  180_000,
);

const RESET_LEAKS = `export const port: number = JSON.parse("8080");\nexport const first = (value: unknown): string => (Array.isArray(value) ? value[0] : "");\n`;
const RESET_CHECKED = `export const port = Number(JSON.parse("8080"));\nexport const first = (value: unknown): string => (Array.isArray(value) && typeof value[0] === "string" ? value[0] : "");\n`;

test(
  "packed-tarball consumer with its own include fails tsc on an Array.isArray and a JSON.parse leak, passes once each is checked",
  async () => {
    await useConsumer("tarball");
    const compilerOptions = { strict: true, noEmit: true, module: "preserve", moduleResolution: "bundler" };
    await writeFile(join(dir, "tsconfig.json"), JSON.stringify({ extends: "@avi2dg/checks/tsconfig.effect.json", compilerOptions, include: ["src"] }));
    await mkdir(join(dir, "src"));
    await writeFile(join(dir, "src", "leaks.ts"), RESET_LEAKS);
    const tsc = (): Promise<Ran> => ran($`${join(dir, "node_modules", ".bin", "tsc")}`.cwd(dir));

    const red = await tsc();
    expect(red.text).toContain("src/leaks.ts(1,14): error TS2322: Type 'unknown' is not assignable to type 'number'.");
    expect(red.text).toMatch(/src\/leaks\.ts\(2,\d+\): error TS2322: Type 'unknown' is not assignable to type 'string'\./);
    expect(red.exitCode).not.toBe(0);

    await writeFile(join(dir, "src", "leaks.ts"), RESET_CHECKED);
    expect(await tsc()).toEqual({ exitCode: 0, text: "" });
  },
  180_000,
);

test(
  "packed tarball holds no file knip names as unreferenced when every bin and exports target is an entry",
  async () => {
    const unpacked = await mkdtemp(join(tmpdir(), "checks-tarball-knip-"));
    try {
      await $`tar -xzf ${tarballPath} -C ${unpacked}`.quiet();
      const root = join(unpacked, "package");
      const manifest = Schema.decodeSync(Manifest)(await readFile(join(CHECKOUT, "package.json"), "utf8"));
      const oxlintrc = Schema.decodeSync(OxlintPlugins)(await readFile(join(root, "oxlintrc.json"), "utf8"));
      const entry = [
        ...Object.values(manifest.bin),
        ...Object.values(manifest.exports),
        ...oxlintrc.jsPlugins,
        "commitlint.config.js",
      ].map((target) => (target.startsWith("./") ? target.slice(2) : target));
      await writeFile(join(root, "knip.tarball.json"), JSON.stringify({ entry, commitlint: false }));
      const knip = join(CHECKOUT, "node_modules", ".bin", "knip");
      const scan = () => ran($`${knip} --production --include files --no-progress -c knip.tarball.json`.cwd(root));
      await writeFile(join(root, "src", "planted-dead.ts"), `export const planted = 1;\n`);
      const red = await scan();
      expect(red.exitCode).not.toBe(0);
      expect(red.text).toContain("src/planted-dead.ts");
      await rm(join(root, "src", "planted-dead.ts"));
      const scanned = await scan();
      expect(scanned.text).not.toContain("Unused files");
      expect(scanned.exitCode).toBe(0);
    } finally {
      await rm(unpacked, { recursive: true, force: true });
    }
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
        compare: "checks-mutation-compare mutation.json mutation.json",
        wiring: "checks-ci-wiring",
        flake: "checks-flake --runs 2",
        repetition: "checks-repetition HEAD",
        docs: "checks-docs HEAD",
        kit: "oxlint --type-aware && checks-lint",
      },
    });
    await mkdir(join(dir, ".github/workflows"), { recursive: true });
    await writeFile(join(dir, ".github/workflows/ci.yml"), "on: pull_request\njobs:\n  checks:\n    runs-on: ubuntu-latest\n    steps:\n      - run: bun run lint\n      - run: bun run build\n      - run: git diff --exit-code\n      - run: bun run typecheck\n      - run: bun run test\n");
    await writeFile(join(dir, ".github/workflows/commitlint.yml"), "on: pull_request\njobs:\n  title:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ./node_modules/.bin/commitlint\n");
    await writeFile(join(dir, "knip.json"), JSON.stringify({ entry: ["*.ts", "tests/**/*.ts"], include: ["files"] }));

    const manifest = Schema.decodeSync(Manifest)(await readFile(join(CHECKOUT, "package.json"), "utf8"));
    const bins = Object.keys(manifest.bin);
    expect(bins).toContain("checks-ci-wiring");
    expect(bins.filter((bin) => !existsSync(join(dir, "node_modules", ".bin", bin)))).toEqual([]);

    await writeFile(join(dir, "mutation.json"), await readFile(join(CHECKOUT, "tests/fixtures/mutation-compare/base.json"), "utf8"));

    await writeWidgetRepo("tests/unit/widget.test.ts", "../../widget.ts");
    await commitAll("feat: base");
    await writeFile(join(dir, "clean.ts"), `export const answer = 42;\n`);
    await commitAll("feat: second");

    const lint = await runScript("lint");
    expect(lint.text).toContain("tracked .ts/.tsx/.astro files");
    expect(lint.text).toContain("holds the ts-reset rules is-array and json-parse");
    expect(lint.text).toContain("satisfy the layout");
    expect(lint.text).toContain("carry only allowed identities");
    expect(lint.exitCode).toBe(0);

    const gate = await runScript("gate");
    expect(gate.text).toContain("carry no refused comment");
    expect(gate.exitCode).toBe(0);

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
      ["wiring", "3 gate(s) run on pull requests to main"],
      ["repetition", "repetition: the head holds no .jscpd.json, so no file is measured"],
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
  "packed-tarball consumer goes red on a dead file through the published knip base, green once it is removed",
  async () => {
    await useConsumer("tarball", { scripts: { unused: "checks-unused" } });
    await writeFile(join(dir, "knip.config.ts"), `import base from "@avi2dg/checks/knip-base.json";\nexport default { ...base, entry: ["index.ts"] };\n`);
    await writeFile(join(dir, "index.ts"), `import { used } from "./used.ts";\n\nexport const index = used;\n`);
    await writeFile(join(dir, "used.ts"), `export const used = 1;\nexport const unusedExport = 2;\n`);
    await writeFile(join(dir, "dead.ts"), `export const dead = 1;\n`);
    await $`git init -q && git add -A`.cwd(dir).quiet();

    const red = await runScript("unused");
    expect(red.exitCode).toBe(1);
    expect(red.text).toContain("unused: 1 unreferenced file(s):\n  dead.ts");
    expect(red.text).not.toContain("unusedExport");

    await rm(join(dir, "dead.ts"));
    await $`git add -A`.cwd(dir).quiet();
    const green = await runScript("unused");
    expect(green.exitCode).toBe(0);
    expect(green.text).toContain("unused: no unreferenced files among 3 tracked .ts/.tsx/.astro file(s)");
  },
  180_000,
);

test(
  "packed-tarball consumer uses native Effect overrides without generated fragments",
  async () => {
    await useConsumer("tarball");
    await writeOxlintrc({
      overrides: [{
        files: ["src/**/*.ts"],
        plugins: ["typescript", "oxc", "eslint", "import", "node", "promise", "unicorn"],
        rules: { "effect-channel/no-throw": "error", "effect-channel/no-try-catch": "error" },
      }],
    });
    await writeFile(join(dir, "tsconfig.json"), JSON.stringify({ extends: ["@avi2dg/checks/tsconfig.effect.json"], include: ["src/**/*.ts"] }));
    await mkdir(join(dir, "src"));
    await writeFile(join(dir, "src", "load.ts"), "export const load = (text: string): string => text;\n");
    await writeFile(join(dir, "edge.ts"), `export function edge(): never {\n  throw new Error("outside the declared paths");\n}\n`);
    await $`git init -q`.cwd(dir).quiet();
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
