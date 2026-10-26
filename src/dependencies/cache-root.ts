import { Config, Effect, Path, Schema } from "effect";

const CACHE_HOME = ".cache/avi2dg-checks";

class CacheUnrooted extends Schema.TaggedError<CacheUnrooted>()("CacheUnrooted", {
  message: Schema.String,
}) {}

export const cacheRoot = Effect.fn("cacheRoot")(function* () {
  const path = yield* Path.Path;
  const home = yield* Config.NonEmptyString("HOME").pipe(
    Effect.mapError(() => new CacheUnrooted({ message: "HOME is missing, so the shared cache has no root" })),
  );
  return path.join(home, CACHE_HOME);
});
