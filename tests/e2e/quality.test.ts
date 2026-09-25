import { $ } from "bun";
import { expect, test } from "bun:test";
import { mkdir, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { OXLINT_FRAGMENT, TSCONFIG_FRAGMENT } from "../../scripts/quality.ts";
import { withoutPullRequestEvent } from "../lib/env.ts";
import { findings } from "./lib/findings.ts";
import { CHECKOUT, ran, scratchDirs, type Ran } from "./lib/fixture-repo.ts";

const QUALITY = join(CHECKOUT, "scripts", "quality.ts");
const LINT = join(CHECKOUT, "scripts", "lint.ts");
const BIN = join(CHECKOUT, "node_modules", ".bin");
const OWNER = { name: "Quinn Example", email: "quinn@example.com" };
const EFFECT = { paths: ["src/**/*.ts"], exempt: ["src/host/*.ts"] };

const UNICORN_BAIT = `export const sorted = [3, 1, 2].sort((left, right) => left - right);
export function outer(): () => number {
  function inner(): number {
    return 1;
  }
  return inner;
}
`;
const THROWS = `export function fail(): never {\n  throw new Error("no channel");\n}\n`;
const ASYNC = `export async function later(): Promise<number> {\n  return 1;\n}\n`;

const scratch = scratchDirs();

let dir = "";

async function put(file: string, content: string | Readonly<Record<string, unknown>>): Promise<void> {
  await mkdir(dirname(join(dir, file)), { recursive: true });
  await writeFile(join(dir, file), typeof content === "string" ? content : JSON.stringify(content, null, 2));
}

async function consumer(quality: Readonly<Record<string, unknown>>): Promise<void> {
  dir = await scratch("checks-quality-");
  await mkdir(join(dir, "node_modules", "@avi2dg"), { recursive: true });
  for (const entry of await readdir(join(CHECKOUT, "node_modules"))) {
    await symlink(join(CHECKOUT, "node_modules", entry), join(dir, "node_modules", entry));
  }
  await symlink(CHECKOUT, join(dir, "node_modules", "@avi2dg", "checks"));
  await put(".gitignore", "node_modules/\n");
  await put("quality.json", { $schema: "./node_modules/@avi2dg/checks/quality.schema.json", ...quality });
  await put(".oxlintrc.json", {
    extends: ["./node_modules/@avi2dg/checks/oxlintrc.json", `./${OXLINT_FRAGMENT}`],
    plugins: ["typescript", "oxc", "eslint", "import"],
  });
  await put("tsconfig.json", {
    extends: ["@avi2dg/checks/tsconfig.effect.json", `./${TSCONFIG_FRAGMENT}`],
    compilerOptions: { target: "esnext", module: "preserve", moduleResolution: "bundler", strict: true, noEmit: true, types: [] },
    include: ["src/**/*.ts", "tools/**/*.ts"],
  });
  await $`git init -q -b main`.cwd(dir).quiet();
}

function run(program: string, args: readonly string[]): Promise<Ran> {
  return ran($`${program} ${args}`.cwd(dir).env({ ...withoutPullRequestEvent(), PATH: `${BIN}:${process.env["PATH"] ?? ""}` }));
}

const quality = (...args: readonly string[]) => run("bun", [QUALITY, ...args]);

async function oxlint(): Promise<ReadonlyMap<string, readonly string[]>> {
  const { text } = await run(join(BIN, "oxlint"), ["--type-aware", "-f", "unix"]);
  return findings(text, /^(\S+?):\d+:\d+: .*\[Error\/([^\]]+)\]$/gm);
}

test(
  "the generated oxlint fragment holds the declared paths to the Effect rules and turns on no plugin besides",
  async () => {
    await consumer({ sources: { effect: EFFECT } });
    await put("src/sorted.ts", UNICORN_BAIT);
    await put("tools/sorted.ts", UNICORN_BAIT);
    await put("src/host/escape.ts", THROWS);
    await put("tools/escape.ts", THROWS);

    const generated = await quality("generate");
    expect(generated.text).toContain(`wrote ${OXLINT_FRAGMENT}`);
    expect(generated.exitCode).toBe(0);
    expect(await oxlint()).toEqual(new Map());

    await put("src/escape.ts", THROWS);
    expect(await oxlint()).toEqual(new Map([["src/escape.ts", ["effect-channel(no-throw)"]]]));
  },
  60_000,
);

test(
  "the generated tsconfig fragment holds the declared paths to the language service from the repository root",
  async () => {
    await consumer({ sources: { effect: EFFECT } });
    await put("src/later.ts", ASYNC);
    await put("src/host/later.ts", ASYNC);
    await put("tools/later.ts", ASYNC);

    expect((await quality("generate")).exitCode).toBe(0);
    const { text } = await run(join(BIN, "effect-tsgo"), ["diagnostics", "--project", "tsconfig.json", "--format", "text", "--strict"]);
    const refused = findings(text, /((?:src|tools)\/[\w/]+\.ts)\(\d+,\d+\): error effect\((\w+)\)/g);
    expect(refused).toEqual(new Map([["src/later.ts", ["asyncFunction"]]]));
  },
  60_000,
);

test(
  "checks-quality --check refuses a missing, stale, left-over or unread fragment and a path that matches no file",
  async () => {
    await consumer({ sources: { effect: { paths: ["src/**/*.ts"] } } });
    await put("src/a.ts", "export const a = 1;\n");

    const missing = await quality("--check");
    expect(missing.exitCode).toBe(1);
    expect(missing.text).toContain(`${OXLINT_FRAGMENT} is missing; run checks-quality generate`);
    expect(missing.text).toContain(`${TSCONFIG_FRAGMENT} is missing; run checks-quality generate`);

    expect((await quality("generate")).exitCode).toBe(0);
    const fresh = await quality("--check");
    expect(fresh.text).toContain(`checks-quality: ${OXLINT_FRAGMENT} and ${TSCONFIG_FRAGMENT} hold what quality.json declares`);
    expect(fresh.exitCode).toBe(0);

    await put("quality.json", { sources: { effect: { paths: ["src/**/*.ts", "lib/**/*.ts"] } } });
    const stale = await quality("--check");
    expect(stale.exitCode).toBe(1);
    expect(stale.text).toContain(`${OXLINT_FRAGMENT} is stale against quality.json and the kit's presets`);
    expect(stale.text).toContain(`${TSCONFIG_FRAGMENT} is stale against quality.json and the kit's presets`);
    expect(stale.text).toContain("sources.effect.paths lib/**/*.ts matches no file");

    const regenerated = await quality("generate");
    expect(regenerated.text).not.toContain("is stale");
    expect(regenerated.exitCode).toBe(1);
    await put("lib/b.ts", "export const b = 1;\n");
    expect((await quality("--check")).exitCode).toBe(0);

    const sources = { production: ["src/**/*.ts", "app/**/*.ts"], effect: { paths: ["src/**/*.ts", "lib/**/*.ts"] } };
    await put("quality.json", { sources });
    const unmatchedProduction = await quality("--check");
    expect(unmatchedProduction.text).toContain(
      "sources.production app/**/*.ts matches no file, so it holds no source to checks-size-budget or checks-repetition",
    );
    expect(unmatchedProduction.text).not.toContain("src/**/*.ts matches no file");
    expect(unmatchedProduction.exitCode).toBe(1);
    await put("app/c.ts", "export const c = 1;\n");
    expect((await quality("--check")).exitCode).toBe(0);

    const oxlintrc = await readFile(join(dir, ".oxlintrc.json"), "utf8");
    await put(".oxlintrc.json", oxlintrc.replace(`, "./${OXLINT_FRAGMENT}"`, "").replace(`,\n    "./${OXLINT_FRAGMENT}"`, ""));
    const unread = await quality("--check");
    expect(unread.text).toContain(`.oxlintrc.json does not extend ./${OXLINT_FRAGMENT}, so oxlint never reads it`);
    expect(unread.exitCode).toBe(1);
    await put(".oxlintrc.json", oxlintrc);

    await put("quality.json", {});
    const leftOver = await quality("--check");
    expect(leftOver.text).toContain(`${OXLINT_FRAGMENT} is left over, since no sources.effect is declared`);
    expect(leftOver.exitCode).toBe(1);
    const cleared = await quality("generate");
    expect(cleared.text).toContain(`removed ${TSCONFIG_FRAGMENT}`);
    expect(cleared.text).toContain("no sources.effect is declared, so nothing is generated");
    expect(cleared.exitCode).toBe(0);

    await put("quality.json", { sources: { effect: { paths: ["*.ts"] } } });
    const malformed = await quality("--check");
    expect(malformed.text).toContain("Expected a glob from the repository root");
    expect(malformed.exitCode).toBe(2);
    expect((await quality()).exitCode).toBe(2);
  },
  60_000,
);

test(
  "checks-lint runs checks-quality and reads the default branch and commit identity from quality.json",
  async () => {
    await consumer({
      defaultBranch: "trunk",
      gates: { ci: ["bun run lint"] },
      commitIdentity: { authors: [OWNER] },
      sources: { effect: { paths: ["src/**/*.ts"] } },
    });
    await put("package.json", { name: "checks-quality-fixture", type: "module", scripts: { lint: "checks-lint", test: "checks-test" } });
    await put("bunfig.toml", await readFile(join(CHECKOUT, "bunfig.toml"), "utf8"));
    await put(".github/workflows/ci.yml", "on:\n  pull_request:\n    branches: [trunk]\njobs:\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - run: bun run lint\n");
    await put("src/a.ts", "export const a = 1;\n");
    await put("src/host/b.ts", "export const b = 1;\n");
    expect((await quality("generate")).exitCode).toBe(0);
    const commit = (message: string) =>
      $`git add -A && git -c user.name=${OWNER.name} -c user.email=${OWNER.email} commit -q --no-gpg-sign -m ${message}`
        .cwd(dir)
        .quiet();
    await commit("feat: base");

    const declared = JSON.parse(await readFile(join(dir, "quality.json"), "utf8"));
    await put("quality.json", { ...declared, sources: { effect: EFFECT } });
    await commit("feat: exempt the host files");
    const red = await run("bun", [LINT]);
    expect(red.text).toContain(`${OXLINT_FRAGMENT} is stale against quality.json`);
    expect(red.text).toContain("checks-lint: 1 of 11 gate(s) failed: checks-quality");
    expect(red.exitCode).toBe(1);

    expect((await quality("generate")).exitCode).toBe(0);
    await commit("build: regenerate the quality fragments");
    const green = await run("bun", [LINT]);
    expect(green.text).toContain("carry only allowed identities");
    expect(green.text).toContain("ci-wiring: 1 gate(s) run on pull requests to trunk");
    expect(green.text).toContain("checks-lint: 11 gate(s) pass");
    expect(green.exitCode).toBe(0);
  },
  60_000,
);
