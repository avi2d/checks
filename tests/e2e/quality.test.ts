import { $ } from "bun";
import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { OXLINT_FRAGMENT, TSCONFIG_FRAGMENT } from "../../scripts/quality.ts";
import { consumerTrees, KIT_BIN, type KitTree } from "./lib/consumer-tree.ts";
import { findings } from "./lib/findings.ts";
import { CHECKOUT } from "./lib/fixture-repo.ts";

const QUALITY = join(CHECKOUT, "scripts", "quality.ts");
const LINT = join(CHECKOUT, "scripts", "lint.ts");
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

const consumerTree = consumerTrees("checks-quality-");

let tree: KitTree;

async function consumer(quality: Readonly<Record<string, unknown>>): Promise<void> {
  tree = await consumerTree({ quality, include: ["src/**/*.ts", "tools/**/*.ts"], types: [] });
}

const quality = (...args: readonly string[]) => tree.run("bun", [QUALITY, ...args]);

async function oxlint(): Promise<ReadonlyMap<string, readonly string[]>> {
  const { text } = await tree.run(join(KIT_BIN, "oxlint"), ["--type-aware", "-f", "unix"]);
  return findings(text, /^(\S+?):\d+:\d+: .*\[Error\/([^\]]+)\]$/gm);
}

test(
  "the generated oxlint fragment holds the declared paths to the Effect rules and turns on no plugin besides",
  async () => {
    await consumer({ sources: { effect: EFFECT } });
    await tree.put("src/sorted.ts", UNICORN_BAIT);
    await tree.put("tools/sorted.ts", UNICORN_BAIT);
    await tree.put("src/host/escape.ts", THROWS);
    await tree.put("tools/escape.ts", THROWS);

    const generated = await quality("generate");
    expect(generated.text).toContain(`wrote ${OXLINT_FRAGMENT}`);
    expect(generated.exitCode).toBe(0);
    expect(await oxlint()).toEqual(new Map());

    await tree.put("src/escape.ts", THROWS);
    expect(await oxlint()).toEqual(new Map([["src/escape.ts", ["effect-channel(no-throw)"]]]));
  },
  60_000,
);

test(
  "the generated tsconfig fragment holds the declared paths to the language service from the repository root",
  async () => {
    await consumer({ sources: { effect: EFFECT } });
    await tree.put("src/later.ts", ASYNC);
    await tree.put("src/host/later.ts", ASYNC);
    await tree.put("tools/later.ts", ASYNC);

    expect((await quality("generate")).exitCode).toBe(0);
    const { text } = await tree.run(join(KIT_BIN, "effect-tsgo"), ["diagnostics", "--project", "tsconfig.json", "--format", "text", "--strict"]);
    const refused = findings(text, /((?:src|tools)\/[\w/]+\.ts)\(\d+,\d+\): error effect\((\w+)\)/g);
    expect(refused).toEqual(new Map([["src/later.ts", ["asyncFunction"]]]));
  },
  60_000,
);

test(
  "checks-quality --check refuses a missing, stale, left-over or unread fragment and a path that matches no file",
  async () => {
    await consumer({ sources: { effect: { paths: ["src/**/*.ts"] } } });
    await tree.put("src/a.ts", "export const a = 1;\n");

    const missing = await quality("--check");
    expect(missing.exitCode).toBe(1);
    expect(missing.text).toContain(`${OXLINT_FRAGMENT} is missing; run checks-quality generate`);
    expect(missing.text).toContain(`${TSCONFIG_FRAGMENT} is missing; run checks-quality generate`);

    expect((await quality("generate")).exitCode).toBe(0);
    const fresh = await quality("--check");
    expect(fresh.text).toContain(`checks-quality: ${OXLINT_FRAGMENT} and ${TSCONFIG_FRAGMENT} hold what quality.json declares`);
    expect(fresh.exitCode).toBe(0);

    await tree.put("quality.json", { sources: { effect: { paths: ["src/**/*.ts", "lib/**/*.ts"] } } });
    const stale = await quality("--check");
    expect(stale.exitCode).toBe(1);
    expect(stale.text).toContain(`${OXLINT_FRAGMENT} is stale against quality.json and the kit's presets`);
    expect(stale.text).toContain(`${TSCONFIG_FRAGMENT} is stale against quality.json and the kit's presets`);
    expect(stale.text).toContain("sources.effect.paths lib/**/*.ts matches no file");

    const regenerated = await quality("generate");
    expect(regenerated.text).not.toContain("is stale");
    expect(regenerated.exitCode).toBe(1);
    await tree.put("lib/b.ts", "export const b = 1;\n");
    expect((await quality("--check")).exitCode).toBe(0);

    const sources = { production: ["src/**/*.ts", "app/**/*.ts"], effect: { paths: ["src/**/*.ts", "lib/**/*.ts"] } };
    await tree.put("quality.json", { sources });
    const unmatchedProduction = await quality("--check");
    expect(unmatchedProduction.text).toContain(
      "sources.production app/**/*.ts matches no file, so it holds no source to checks-size-budget or checks-repetition",
    );
    expect(unmatchedProduction.text).not.toContain("src/**/*.ts matches no file");
    expect(unmatchedProduction.exitCode).toBe(1);
    await tree.put("app/c.ts", "export const c = 1;\n");
    expect((await quality("--check")).exitCode).toBe(0);

    const oxlintrc = await readFile(join(tree.dir, ".oxlintrc.json"), "utf8");
    await tree.put(".oxlintrc.json", oxlintrc.replace(`, "./${OXLINT_FRAGMENT}"`, "").replace(`,\n    "./${OXLINT_FRAGMENT}"`, ""));
    const unread = await quality("--check");
    expect(unread.text).toContain(`.oxlintrc.json does not extend ./${OXLINT_FRAGMENT}, so oxlint never reads it`);
    expect(unread.exitCode).toBe(1);
    await tree.put(".oxlintrc.json", oxlintrc);

    await tree.put("quality.json", {});
    const leftOver = await quality("--check");
    expect(leftOver.text).toContain(`${OXLINT_FRAGMENT} is left over, since no sources.effect is declared`);
    expect(leftOver.exitCode).toBe(1);
    const cleared = await quality("generate");
    expect(cleared.text).toContain(`removed ${TSCONFIG_FRAGMENT}`);
    expect(cleared.text).toContain("no sources.effect is declared, so nothing is generated");
    expect(cleared.exitCode).toBe(0);

    await tree.put("quality.json", { sources: { effect: { paths: ["*.ts"] } } });
    const malformed = await quality("--check");
    expect(malformed.text).toContain("Expected a glob from the repository root");
    expect(malformed.exitCode).toBe(2);
    expect((await quality()).exitCode).toBe(2);
  },
  60_000,
);

test(
  "checks-quality requires the kit configs that apply the Effect rules",
  async () => {
    await consumer({ sources: { effect: EFFECT } });
    await tree.put("src/a.ts", "export const a = 1;\n");
    expect((await quality("generate")).exitCode).toBe(0);

    const oxlintrc = await readFile(join(tree.dir, ".oxlintrc.json"), "utf8");
    await tree.put(
      ".oxlintrc.json",
      oxlintrc.replace('"./node_modules/@avi2dg/checks/oxlintrc.json",', ""),
    );
    const missingOxlintConfig = await quality("--check");
    expect(missingOxlintConfig.text).toContain(
      ".oxlintrc.json does not extend ./node_modules/@avi2dg/checks/oxlintrc.json, so the kit's oxlint rules are not loaded",
    );
    expect(missingOxlintConfig.exitCode).toBe(1);
    await tree.put(".oxlintrc.json", oxlintrc);
    expect((await quality("--check")).exitCode).toBe(0);

    const tsconfig = await readFile(join(tree.dir, "tsconfig.json"), "utf8");
    const tsconfigRefusal =
      "tsconfig.json does not extend @avi2dg/checks/tsconfig.effect.json, the one accepted spelling of the kit's Effect config";
    await tree.put("tsconfig.json", tsconfig.replace('"@avi2dg/checks/tsconfig.effect.json",', ""));
    const missingTsconfig = await quality("--check");
    expect(missingTsconfig.text).toContain(tsconfigRefusal);
    expect(missingTsconfig.exitCode).toBe(1);
    await tree.put(
      "tsconfig.json",
      tsconfig.replace('"@avi2dg/checks/tsconfig.effect.json"', '"./node_modules/@avi2dg/checks/tsconfig.effect.json"'),
    );
    const nodeModulesTsconfig = await quality("--check");
    expect(nodeModulesTsconfig.text).toContain(tsconfigRefusal);
    expect(nodeModulesTsconfig.exitCode).toBe(1);
    await tree.put("tsconfig.json", tsconfig);
    expect((await quality("--check")).exitCode).toBe(0);
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
    await tree.put("package.json", { name: "checks-quality-fixture", type: "module", scripts: { lint: "checks-lint", test: "checks-test" } });
    await tree.put("bunfig.toml", await readFile(join(CHECKOUT, "bunfig.toml"), "utf8"));
    await tree.put(".github/workflows/ci.yml", "on:\n  pull_request:\n    branches: [trunk]\njobs:\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - run: bun run lint\n");
    await tree.put("src/a.ts", "export const a = 1;\n");
    await tree.put("src/host/b.ts", "export const b = 1;\n");
    expect((await quality("generate")).exitCode).toBe(0);
    const commit = (message: string) =>
      $`git add -A && git -c user.name=${OWNER.name} -c user.email=${OWNER.email} commit -q --no-gpg-sign -m ${message}`
        .cwd(tree.dir)
        .quiet();
    await commit("feat: base");

    const declared = JSON.parse(await readFile(join(tree.dir, "quality.json"), "utf8"));
    await tree.put("quality.json", { ...declared, sources: { effect: EFFECT } });
    await commit("feat: exempt the host files");
    const red = await tree.run("bun", [LINT]);
    expect(red.text).toContain(`${OXLINT_FRAGMENT} is stale against quality.json`);
    expect(red.text).toContain("checks-lint: 1 of 11 gate(s) failed: checks-quality");
    expect(red.exitCode).toBe(1);

    expect((await quality("generate")).exitCode).toBe(0);
    await commit("build: regenerate the quality fragments");
    const green = await tree.run("bun", [LINT]);
    expect(green.text).toContain("carry only allowed identities");
    expect(green.text).toContain("ci-wiring: 1 gate(s) run on pull requests to trunk");
    expect(green.text).toContain("checks-lint: 11 gate(s) pass");
    expect(green.exitCode).toBe(0);
  },
  60_000,
);
