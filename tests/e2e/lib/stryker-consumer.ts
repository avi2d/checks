import { $ } from "bun";
import { expect } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Schema } from "effect";
import { CHECKOUT, ran, type Ran } from "./fixture-repo.ts";
import { fakeActions } from "./fake-actions.ts";

export const STRYKER_CONFIG = `import preset, { unitTestFiles } from "@avi2dg/checks/stryker.preset.js";

export default {
  ...preset,
  bun: {
    ...preset.bun,
    testFiles: unitTestFiles(),
  },
};
`;

export function expectStrykerExitsZero(result: Ran): void {
  if (result.exitCode !== 0) throw new Error(`stryker exited ${result.exitCode}:\n${result.text}`);
}

export const WIDGET_TEST = `import { expect, test } from "bun:test";
import { widget } from "../../widget.ts";

test("widget", () => {
  expect(widget).toBe(42);
});
`;

export const widgetTest = (name: string, wait: string): string => `import { expect, test } from "bun:test";
import { widget } from "../../widget.ts";

test("${name}", async () => {
  ${wait}
  expect(widget).toBe(42);
});
`;

export const operandTest = (name: string): string => `import { expect, test } from "bun:test";
import { ${name} } from "../../${name}.ts";

test("${name}", () => {
  expect(${name}).toBe(42);
});
`;

export const reusedOf = (text: string): readonly [reused: number, total: number] | undefined => {
  const matched = /(\d+) of (\d+) mutant result\(s\) are reused/.exec(text);
  return matched === null ? undefined : [Number(matched[1]), Number(matched[2])];
};

const MutantSchema = Schema.Struct({
  replacement: Schema.String,
  status: Schema.String,
  static: Schema.optionalKey(Schema.Boolean),
  coveredBy: Schema.optionalKey(Schema.Array(Schema.String)),
  killedBy: Schema.optionalKey(Schema.Array(Schema.String)),
});

const ReportSchema = Schema.Struct({
  files: Schema.Record(Schema.String, Schema.Struct({ mutants: Schema.Array(MutantSchema) })),
  testFiles: Schema.Record(Schema.String, Schema.Struct({ tests: Schema.Array(Schema.Struct({ id: Schema.String })) })),
});

export type Report = typeof ReportSchema.Type;

export const readReport = (path: string): Promise<Report> =>
  Bun.file(path).json().then((json: unknown) => Schema.decodeUnknownSync(ReportSchema)(json));

export const readState = (text: string): Report => Schema.decodeSync(Schema.fromJsonString(ReportSchema))(text);

export const PROBE_TEST = `import { expect, test } from "bun:test";
import { check } from "../../helper.ts";
import { widget } from "../../widget.ts";

test("widget", () => {
  expect(check(widget)).toBe(true);
});
`;

export async function committedBase(dir: string, files: readonly string[]): Promise<string> {
  await $`git init -q -b main`.cwd(dir).quiet();
  await $`git add ${files}`.cwd(dir).quiet();
  await $`git -c user.email=fixture@example.com -c user.name=Fixture commit -qm base`.cwd(dir).quiet();
  return (await $`git rev-parse HEAD`.cwd(dir).quiet()).stdout.toString().trim();
}

export async function restoredFull(dir: string, report: string, state: string, sha: string, createdAt?: string): Promise<string> {
  const nowMs = Number(process.env["CHECKS_MUTATION_BASELINE_NOW_MS"] ?? Date.now());
  const stamp = createdAt ?? new Date(nowMs).toISOString();
  const home = await mkdtemp(join(tmpdir(), "checks-stryker-restore-"));
  try {
    const fake = await fakeActions(home, 4242, [
      {
        databaseId: 35,
        event: "workflow_dispatch",
        createdAt: stamp,
        headSha: sha,
        artifacts: [{ id: 350, name: "mutation-baseline-full", expired: false, files: { "mutation.json": report, "stryker-incremental.json": state } }],
      },
    ]);
    const restored = await ran(
      $`bun ${join(CHECKOUT, "src", "testing", "mutation-baseline.ts")} --full reports/mutation/mutation.json reports/stryker-incremental.json`.cwd(dir).env({
        ...process.env,
        CHECKS_MUTATION_BASELINE_NOW_MS: String(nowMs),
        CI: "true",
        RUNNER_ENVIRONMENT: "self-hosted",
        GITHUB_RUN_ID: undefined,
        GITHUB_REPOSITORY_ID: "4242",
        ...fake.env,
        HOME: home,
      }),
    );
    expect(restored.exitCode).toBe(0);
    return restored.text;
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

export async function dropModuleType(dir: string): Promise<void> {
  const path = join(dir, "package.json");
  const fixturePackage: Record<string, unknown> = {
    ...Schema.decodeSync(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)))(await Bun.file(path).text()),
  };
  delete fixturePackage["type"];
  await writeFile(path, JSON.stringify(fixturePackage));
}

export async function unpackConsumer(): Promise<{ readonly packDir: string; readonly dir: string }> {
  const packDir = await mkdtemp(join(tmpdir(), "checks-stryker-pack-"));
  const tarball = (await $`bun pm pack --destination ${packDir} --quiet --ignore-scripts`.cwd(CHECKOUT).quiet()).stdout.toString().trim();
  const dir = await mkdtemp(join(tmpdir(), "checks-stryker-consumer-"));
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({
      name: "checks-stryker-fixture",
      type: "module",
      devDependencies: {
        "@avi2dg/checks": `file:${tarball}`,
        "@hughescr/stryker-bun-runner": "1.4.0",
        "@stryker-mutator/core": "10.0.0",
        "@types/bun": "1.4.2",
        effect: "4.0.0",
      },
    }),
  );
  await $`bun install`.cwd(dir).quiet();
  return { packDir, dir };
}

export async function removeConsumer(paths: readonly string[]): Promise<void> {
  for (const one of paths) if (one !== "") await rm(one, { recursive: true, force: true });
}
