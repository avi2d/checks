import { expect, test } from "bun:test";
import { join } from "node:path";
import { CHECKOUT } from "../lib/fixture-repo.ts";
import { SCOPED, BIN_PLANT, UNSCOPED, SCOPE_OXLINT, PROCESS_EXIT, SCOPE_SERVICE, KIT_SERVICE, scopeConsumer } from "../lib/effect-scope-consumer.ts";

const { tree, consumer, ownOxlintConfig, plantViolations, plantClean, oxlint, diagnostics } = scopeConsumer("checks-effect-scope-consumer-");

test(
  "scope lint rules fail in the declared paths and tests/ stays green",
  async () => {
    await consumer();
    await plantViolations();
    const red = await oxlint();
    expect(red.exitCode).not.toBe(0);
    expect(red.linted.get(SCOPED)).toEqual(expect.arrayContaining(SCOPE_OXLINT));
    for (const rule of SCOPE_OXLINT) expect(red.linted.get(UNSCOPED) ?? []).not.toContain(rule);

    await plantClean();
    const green = await oxlint();
    expect(green.linted).toEqual(new Map());
    expect(green.exitCode).toBe(0);
  },
  180_000,
);

test(
  "scope diagnostics fail in the declared paths and the kit severities fail there and in tests/",
  async () => {
    await consumer();
    await plantViolations();
    const refused = await diagnostics();
    expect(refused.get(SCOPED)).toEqual(expect.arrayContaining([...SCOPE_SERVICE, ...KIT_SERVICE]));
    for (const rule of SCOPE_SERVICE) expect(refused.get(UNSCOPED) ?? []).not.toContain(rule);
    expect(refused.get(UNSCOPED)).toEqual(expect.arrayContaining(KIT_SERVICE));

    await plantClean();
    expect(await diagnostics()).toEqual(new Map());
  },
  180_000,
);

test(
  "generated config does not suggest recovery the oxlint base rejects",
  async () => {
    await consumer();
    const config = await Bun.file(join(tree.dir, "tsconfig.json")).json();
    const severity = config.compilerOptions.plugins[0].diagnosticSeverity;
    for (const rule of ["catchAllToMapError", "catchToIgnore", "catchToOrElseSucceed"]) {
      expect(severity[rule]).toBe("off");
    }

    await tree.put(SCOPED, `import { Effect } from "effect";
declare const input: Effect.Effect<void, string>;
export const ignored = Effect.ignore(input);
export const fallback = Effect.catch(input, () => Effect.succeed("fallback"));
`);
    const red = await oxlint();
    expect(red.linted.get(SCOPED)?.filter((rule) => rule === "effect-channel(no-error-channel-escape)")).toHaveLength(2);

    await tree.put(SCOPED, `import { Effect } from "effect";
declare const input: Effect.Effect<void, string>;
export const result = Effect.result(input);
export const recovered = Effect.catch(input, (error) => Effect.fail(error.length));
`);
    const green = await oxlint();
    expect(green.linted.get(SCOPED) ?? []).not.toContain("effect-channel(no-error-channel-escape)");
  },
  180_000,
);

test(
  "effect: true written through checks-effect-scope holds every source outside tests/ to the scope rules and diagnostics",
  async () => {
    await consumer();
    await tree.put("oxlint.config.ts", `import { defineConfig } from "@avi2dg/checks/oxlint";\n\nexport default defineConfig({ effect: true });\n`);
    expect((await tree.run(process.execPath, [join(CHECKOUT, "src", "quality", "effect-scope.ts")])).exitCode).toBe(0);
    await plantViolations();

    const red = await oxlint();
    expect(red.linted.get(SCOPED)).toEqual(expect.arrayContaining(SCOPE_OXLINT));
    for (const rule of SCOPE_OXLINT) expect(red.linted.get(UNSCOPED) ?? []).not.toContain(rule);
    const refused = await diagnostics();
    expect(refused.get(SCOPED)).toEqual(expect.arrayContaining(SCOPE_SERVICE));
    for (const rule of SCOPE_SERVICE) expect(refused.get(UNSCOPED) ?? []).not.toContain(rule);
  },
  180_000,
);

test(
  "this checkout's own oxlint config fails a shebang bin on process.exit through the stand-in rule",
  async () => {
    await ownOxlintConfig();
    await tree.put(BIN_PLANT, "#!/usr/bin/env bun\nprocess.exit(1);\n");

    const red = await oxlint([]);
    expect(red.exitCode).not.toBe(0);
    expect(red.linted.get(BIN_PLANT)).toContain(PROCESS_EXIT);
    expect(red.linted.get(BIN_PLANT)).not.toContain("unicorn(no-process-exit)");

    await tree.put(BIN_PLANT, "#!/usr/bin/env bun\nexport const answer = 42;\n");
    const green = await oxlint([]);
    expect(green.linted).toEqual(new Map());
    expect(green.exitCode).toBe(0);
  },
  180_000,
);
