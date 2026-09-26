import { Clock, Duration, Effect, FileSystem, Option, Schema } from "effect";

export class LockError extends Schema.TaggedError<LockError>()("LockError", {
  message: Schema.String,
}) {}

const LOCK_MODE = 0o644;
const POLL = Duration.millis(250);
// A holder killed before its release leaves the file behind, so one this old no longer excludes anyone.
export const STALE_AFTER = Duration.minutes(2);

const taken = Effect.fn("taken")(function* (lock: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.writeFileString(lock, "", { flag: "wx", mode: LOCK_MODE }).pipe(
    Effect.as(true),
    Effect.catchReason("PlatformError", "AlreadyExists", () => Effect.succeed(false)),
    Effect.mapError((cause) => new LockError({ message: `cannot take ${lock}: ${cause.message}` })),
  );
});

const stale = Effect.fn("stale")(function* (lock: string) {
  const fs = yield* FileSystem.FileSystem;
  const info = yield* fs.stat(lock).pipe(Effect.option);
  const now = yield* Clock.currentTimeMillis;
  const age = Option.flatMap(info, ({ mtime }) => Option.map(mtime, (at) => now - at.getTime()));
  return Option.exists(age, (millis) => millis > Duration.toMillis(STALE_AFTER));
});

const drop = Effect.fn("drop")(function* (lock: string) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.remove(lock, { force: true }).pipe(
    Effect.mapError((cause) => new LockError({ message: `cannot drop ${lock}: ${cause.message}` })),
  );
});

const pause = Effect.fn("pause")(function* (lock: string) {
  if (yield* stale(lock)) yield* drop(lock);
  else yield* Effect.sleep(POLL);
});

// acquireUseRelease runs this uninterruptibly, and only the pause between two takes may be cut short.
const acquire = Effect.fn("acquire")(function* (lock: string, waiting: Effect.Effect<void>) {
  if (yield* taken(lock)) return;
  yield* waiting;
  do yield* Effect.interruptible(pause(lock));
  while (!(yield* taken(lock)));
});

// The body must stay safe for two runs at once, since another run takes a slow holder's lock once it goes stale.
export function withLock<A, E, R>(
  lock: string,
  body: Effect.Effect<A, E, R>,
  waiting: Effect.Effect<void>,
): Effect.Effect<A, E | LockError, R | FileSystem.FileSystem> {
  return Effect.acquireUseRelease(
    acquire(lock, waiting),
    () => body,
    () => drop(lock),
  );
}
