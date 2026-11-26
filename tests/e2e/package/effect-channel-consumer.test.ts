import { $ } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installConsumer } from "../lib/consumer-install.ts";
import { CHECKOUT, ran, type Ran } from "../lib/fixture-repo.ts";

let dir = "";

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "checks-effect-channel-consumer-"));
  await installConsumer(dir, `file:${CHECKOUT}`);
  await writeFile(join(dir, ".oxlintrc.json"), JSON.stringify({
    extends: ["./node_modules/@avi2dg/checks/oxlintrc.json"],
    plugins: ["typescript", "oxc", "eslint", "import"],
    rules: { "import/namespace": "off", "eslint/no-shadow": "off" },
  }));
}, 360_000);

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
}, 60_000);

async function lint(source: string): Promise<Ran> {
  await writeFile(join(dir, "probe.ts"), source);
  const binary = join(dir, "node_modules", ".bin", "oxlint");
  return ran($`${binary} --format=unix probe.ts`.cwd(dir));
}

function channelDiagnostics(result: Ran): { line: number; message: string }[] {
  return [...result.text.matchAll(/^probe\.ts:(\d+):\d+: (.*) \[Error\/effect-channel\(no-error-channel-escape\)\]$/gm)]
    .map((match) => ({ line: Number(match[1]), message: match[2] ?? "" }))
    .toSorted((a, b) => a.line - b.line);
}

function refusals(result: Ran): string[] {
  return channelDiagnostics(result).map(({ line, message }) => `${line}: ${message.split(" ")[0]}`);
}

const STATIC_IMPORTS = `import { Effect as E } from "effect";
import * as Direct from "effect/Effect";
import { ignore, ignoreCause as discard } from "effect/Effect";
export const a = ignore(E.fail("boom"));
export const b = discard(E.fail("boom"));
export const c = E["ignore"](E.fail("boom"));
export const d = Direct[\`ignoreCause\`](E.fail("boom"));
export const e = discard;
`;

const DYNAMIC_ACCESS = `import { Effect } from "effect";
export const lookup = (key: "ignore" | "ignoreCause"): typeof Effect.ignore | typeof Effect.ignoreCause => Effect[key];
`;

test("consumer rejects named imports, aliases, and static member names instead of missing those escapes", async () => {
  const result = await lint(STATIC_IMPORTS);
  expect(result.exitCode).toBe(1);
  expect(refusals(result)).toEqual(["4: Effect.ignore", "5: Effect.ignoreCause", "6: Effect.ignore", "7: Effect.ignoreCause", "8: Effect.ignoreCause"]);
  expect(await lint(DYNAMIC_ACCESS)).toEqual({ exitCode: 0, text: "" });
});

const SHADOWED = `import { Effect } from "effect";
import { ignore as discard } from "effect/Effect";
export const effect = Effect.succeed(discard(Effect.succeed(1)));
export function parameter(Effect: { ignore: () => number }): number {
  return Effect.ignore();
}
export function local(): number {
  const Effect = { ignore: (): number => 1 };
  const discard = (): number => 2;
  return Effect.ignore() + discard();
}
`;

test("consumer reports the imported discard but not unrelated parameters or locals that shadow Effect bindings", async () => {
  const result = await lint(SHADOWED);
  expect(result.exitCode).toBe(1);
  expect(refusals(result)).toEqual(["3: Effect.ignore"]);
});

const BLIND_HANDLERS = `import { Effect } from "effect";
import { catchEager as recover, orElseSucceed } from "effect/Effect";
const failed = Effect.fail("boom");
export const a = recover(failed, () => Effect.succeed("fallback"));
export const b = failed.pipe(Effect.catchEager((_) => Effect.succeed("fallback")));
export const c = Effect["orElseSucceed"](failed, () => "fallback");
export const d = failed.pipe(orElseSucceed((_) => "fallback"));
`;

const ERROR_AWARE_HANDLERS = `import { Effect } from "effect";
const failed = Effect.fail("boom");
export const a = Effect.catchEager(failed, (error) => Effect.succeed(error.length));
export const b = failed.pipe(Effect.catchEager((error: string) => Effect.succeed(error.length)));
export const c = Effect.orElseSucceed(failed, (error) => error.length);
export const d = failed.pipe(Effect.orElseSucceed((error: string) => error.length));
`;

test("consumer rejects blind catchEager and orElseSucceed handlers in both call forms without rejecting error-aware handlers", async () => {
  const result = await lint(BLIND_HANDLERS);
  expect(result.exitCode).toBe(1);
  expect(refusals(result)).toEqual(["4: Effect.catchEager", "5: Effect.catchEager", "6: Effect.orElseSucceed", "7: Effect.orElseSucceed"]);
  expect(await lint(ERROR_AWARE_HANDLERS)).toEqual({ exitCode: 0, text: "" });
});

const FILTERED_CAUSES = `import { Cause, Effect, Filter } from "effect";
const failed = Effect.fail("boom");
export const byPredicate = Effect.catchCauseIf(failed, Cause.hasFails, () => Effect.succeed("fallback"));
export const byFilter = Effect.catchCauseFilter(failed, Filter.fromPredicate(Cause.hasFails), () => Effect.succeed("fallback"));
`;

test("consumer bans filtered cause recovery without claiming it catches unmatched causes", async () => {
  const result = await lint(FILTERED_CAUSES);
  expect(result.exitCode).toBe(1);
  expect(refusals(result)).toEqual(["3: Effect.catchCauseIf", "4: Effect.catchCauseFilter"]);
  for (const { message } of channelDiagnostics(result)) {
    expect(message).toContain("can recover from a Cause that includes defects or interruptions");
    expect(message).toContain("A non-match still fails");
    expect(message).not.toContain("erases the error channel");
  }
});
