import { expect, test } from "bun:test";
import { Effect, FileSystem, Path } from "effect";
import { run } from "../../../src/testing/run-effect.ts";

test("run resolves with the value of a program that needs Bun's file system and path, rather than leaving them unprovided", async () => {
  const thisFile = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return yield* fs.exists(path.join(import.meta.dir, "run-effect.test.ts"));
  });
  expect(await run(thisFile)).toBe(true);
});

test("run rejects when the program fails, rather than resolving with undefined", async () => {
  const failure = await run(Effect.fail(new Error("boom"))).then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(Error);
  expect(String(failure)).toContain("boom");
});
