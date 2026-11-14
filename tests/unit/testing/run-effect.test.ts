import { expect, test } from "bun:test";
import { Effect, FileSystem, Path, Schema } from "effect";
import { run } from "../../../src/testing/run-effect.ts";

class Boom extends Schema.TaggedError<Boom>()("Boom", {
  message: Schema.String,
}) {}

test("run resolves with the value of a program that needs Bun's file system and path, rather than leaving them unprovided", async () => {
  const thisFile = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return yield* fs.exists(path.join(import.meta.dir, "run-effect.test.ts"));
  });
  expect(await run(thisFile)).toBe(true);
});

test("run rejects when the program fails, rather than resolving with undefined", async () => {
  const failure = await run(Effect.fail(new Boom({ message: "boom" }))).then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(Boom);
  expect(String(failure)).toContain("boom");
});
