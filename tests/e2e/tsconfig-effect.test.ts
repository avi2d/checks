import { $ } from "bun";
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CHECKOUT = resolve(import.meta.dir, "..", "..");

const SEVERITIES = [
  "anyUnknownInErrorContext",
  "unsafeEffectTypeAssertion",
  "missingEffectError",
  "unknownInEffectCatch",
  "globalErrorInEffectCatch",
  "globalErrorInEffectFailure",
  "catchUnfailableEffect",
  "catchAllToMapError",
  "missingReturnYieldStar",
  "floatingEffect",
  "outdatedApi",
];

interface TsconfigEffect {
  compilerOptions?: {
    erasableSyntaxOnly?: boolean;
    plugins?: { name?: string; diagnosticSeverity?: Record<string, string> }[];
  };
}

let dir = "";

afterEach(async () => {
  if (dir !== "") {
    await rm(dir, { recursive: true, force: true });
    dir = "";
  }
});

async function run(binary: string, args: string[]): Promise<{ exitCode: number; text: string }> {
  const result = await $`${binary} ${args}`.cwd(dir).nothrow().quiet();
  return {
    exitCode: result.exitCode,
    text: result.stdout.toString() + result.stderr.toString(),
  };
}

test("tsconfig.effect.json carries the language-service block and erasableSyntaxOnly", async () => {
  // tsc --showConfig drops the plugins block, so the file itself is the contract under test.
  const raw = await readFile(join(CHECKOUT, "tsconfig.effect.json"), "utf8");
  const fragment = JSON.parse(raw) as TsconfigEffect;

  expect(fragment.compilerOptions?.erasableSyntaxOnly).toBe(true);
  const languageService = fragment.compilerOptions?.plugins?.find(
    (plugin) => plugin.name === "@effect/language-service",
  );
  expect(languageService).toBeDefined();
  for (const severity of SEVERITIES) {
    expect(languageService?.diagnosticSeverity?.[severity]).toBe("error");
  }

  // The fragment must also work through extends, not just read correctly.
  dir = await mkdtemp(join(tmpdir(), "checks-tsconfig-"));
  await writeFile(
    join(dir, "tsconfig.json"),
    JSON.stringify({
      extends: join(CHECKOUT, "tsconfig.effect.json"),
      compilerOptions: {
        strict: true,
        noEmit: true,
        module: "preserve",
        moduleResolution: "bundler",
        target: "esnext",
        lib: ["esnext"],
        skipLibCheck: true,
      },
      include: ["plant.ts", "enum-plant.ts"],
    }),
  );
  await writeFile(
    join(dir, "plant.ts"),
    `import { Effect } from "effect";\n\nEffect.succeed(1);\n`,
  );
  await writeFile(join(dir, "enum-plant.ts"), `export enum Color {\n  Red = "red",\n}\n`);
  // effect-tsgo discovers its typescript binary and the effect package from the project directory.
  await symlink(join(CHECKOUT, "node_modules"), join(dir, "node_modules"));

  const diagnostics = await run(join(CHECKOUT, "node_modules", ".bin", "effect-tsgo"), [
    "diagnostics",
    "--project",
    "tsconfig.json",
    "--format",
    "text",
    "--strict",
  ]);
  expect(diagnostics.exitCode).not.toBe(0);
  expect(diagnostics.text).toContain("effect(floatingEffect)");

  const typecheck = await run(join(CHECKOUT, "node_modules", ".bin", "tsc"), ["--noEmit"]);
  expect(typecheck.exitCode).not.toBe(0);
  expect(typecheck.text).toContain("erasableSyntaxOnly");
});
