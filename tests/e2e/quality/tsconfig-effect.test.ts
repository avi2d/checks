import { $ } from "bun";
import { expect, test } from "bun:test";
import { readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Schema } from "effect";
import { CHECKOUT, ran, scratchDirs, type Ran } from "../lib/fixture-repo.ts";

const SEVERITIES = [
  "anyUnknownInErrorContext",
  "unsafeEffectTypeAssertion",
  "missingEffectError",
  "unknownInEffectCatch",
  "globalErrorInEffectCatch",
  "globalErrorInEffectFailure",
  "catchUnfailableEffect",
  "missingReturnYieldStar",
  "floatingEffect",
  "outdatedApi",
];

const TsconfigEffect = Schema.fromJsonString(
  Schema.Struct({
    compilerOptions: Schema.optionalKey(
      Schema.Struct({
        erasableSyntaxOnly: Schema.optionalKey(Schema.Boolean),
        plugins: Schema.optionalKey(
          Schema.Array(
            Schema.Struct({
              name: Schema.optionalKey(Schema.String),
              diagnosticSeverity: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
            }),
          ),
        ),
      }),
    ),
  }),
);

const MUTANT = `import { Schema } from "effect";

const Mutant = Schema.Struct({ status: Schema.String, killedBy: Schema.optionalKey(Schema.Array(Schema.String)) });

export const built: typeof Mutant.Type = { status: "Killed", killedBy: undefined };
`;

const scratch = scratchDirs();

let dir = "";

function run(binary: string, args: readonly string[]): Promise<Ran> {
  return ran($`${binary} ${args}`.cwd(dir));
}

function tsc(): Promise<Ran> {
  return run(join(CHECKOUT, "node_modules", ".bin", "tsc"), ["--noEmit"]);
}

async function consumer(include: readonly string[]): Promise<void> {
  dir = await scratch("checks-tsconfig-");
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
      include,
    }),
  );
  // effect-tsgo discovers its typescript binary and the effect package from the project directory.
  await symlink(join(CHECKOUT, "node_modules"), join(dir, "node_modules"));
}

test("tsconfig.effect.json carries the language-service block and erasableSyntaxOnly", async () => {
  // tsc --showConfig drops the plugins block, so the file itself is the contract under test.
  const raw = await readFile(join(CHECKOUT, "tsconfig.effect.json"), "utf8");
  const fragment = Schema.decodeSync(TsconfigEffect)(raw);

  expect(fragment.compilerOptions?.erasableSyntaxOnly).toBe(true);
  const languageService = fragment.compilerOptions?.plugins?.find(
    (plugin) => plugin.name === "@effect/language-service",
  );
  expect(languageService).toBeDefined();
  for (const severity of SEVERITIES) {
    expect(languageService?.diagnosticSeverity?.[severity]).toBe("error");
  }

  // The fragment must also work through extends, not just read correctly.
  await consumer(["plant.ts", "enum-plant.ts"]);
  await writeFile(
    join(dir, "plant.ts"),
    `import { Effect } from "effect";\n\nEffect.succeed(1);\n`,
  );
  await writeFile(join(dir, "enum-plant.ts"), `export enum Color {\n  Red = "red",\n}\n`);

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

  const typecheck = await tsc();
  expect(typecheck.exitCode).not.toBe(0);
  expect(typecheck.text).toContain("erasableSyntaxOnly");
});

test("the shared policy does not suggest non-equivalent or banned recovery rewrites", async () => {
  await consumer(["mixed-cause.ts", "recovery.ts"]);
  await writeFile(
    join(dir, "mixed-cause.ts"),
    `import { Cause, Effect, Exit } from "effect";
const input = Effect.failCause(Cause.combine(Cause.fail("bad"), Cause.die("bug")));
const outputs = {
  catch: Effect.runSyncExit(Effect.catch(input, (error) => Effect.fail(error.length))),
  mapError: Effect.runSyncExit(Effect.mapError(input, (error) => error.length)),
};
for (const [name, exit] of Object.entries(outputs)) {
  if (Exit.isFailure(exit)) {
    console.log(name, JSON.stringify(exit.cause.reasons.map((reason) =>
      Cause.isFailReason(reason) ? ["Fail", reason.error] :
      Cause.isDieReason(reason) ? ["Die", reason.defect] : ["Interrupt"]
    )));
  }
}
`,
  );
  await writeFile(
    join(dir, "recovery.ts"),
    `import { Effect } from "effect";
declare const input: Effect.Effect<void, string>;
export const ignored = Effect.catch(input, () => Effect.void);
export const fallback = Effect.catch(input, () => Effect.succeed("fallback"));
`,
  );
  const runtime = await run(process.execPath, ["mixed-cause.ts"]);
  expect(runtime.exitCode).toBe(0);
  expect(runtime.text).toContain('catch [["Die","bad"],["Die","bug"]]');
  expect(runtime.text).toContain('mapError [["Fail",3],["Die","bug"]]');

  const diagnostics = await run(join(CHECKOUT, "node_modules", ".bin", "effect-tsgo"), [
    "diagnostics", "--project", "tsconfig.json", "--format", "text", "--strict",
  ]);
  for (const rule of ["catchAllToMapError", "catchToIgnore", "catchToOrElseSucceed"]) {
    expect(diagnostics.text).not.toContain(`effect(${rule})`);
  }
});

test("a consumer of tsconfig.effect.json fails an undefined in a Schema.optionalKey field, passes once the key is left out", async () => {
  await consumer(["mutant.ts"]);
  await writeFile(join(dir, "mutant.ts"), MUTANT);

  const red = await tsc();
  expect(red.exitCode).not.toBe(0);
  expect(red.text).toContain("mutant.ts(5,14): error TS2375");
  expect(red.text).toContain("exactOptionalPropertyTypes");

  await writeFile(join(dir, "mutant.ts"), MUTANT.replace(", killedBy: undefined", ""));
  const green = await tsc();
  expect(green.text).toBe("");
  expect(green.exitCode).toBe(0);
});
