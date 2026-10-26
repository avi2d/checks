import { Clock, Config, Console, Effect, FileSystem, Option, Schema } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { collect } from "../core/git.ts";
import { withoutStale } from "./mutation-baseline-saved.ts";
import { STRYKER_CONFIGS, stalenessSince } from "./mutation-scope.ts";

export class BaselineFailure extends Schema.TaggedError<BaselineFailure>()("BaselineFailure", {
  message: Schema.String,
}) {}

export const gh = Effect.fn("gh")(function* (args: readonly string[]) {
  const failed = (reason: string): BaselineFailure => new BaselineFailure({ message: `gh ${args.join(" ")}: ${reason.trim()}` });
  const { stdout, stderr, exitCode } = yield* collect("gh", args).pipe(Effect.mapError((cause) => failed(cause.message)));
  if (exitCode !== ChildProcessSpawner.ExitCode(0)) return yield* failed(stderr);
  return stdout;
});

const FULL_CONFIGS = [...STRYKER_CONFIGS, "stryker.preset.js", "bun.lock", ".bun-version"];

const REFRESH_DAYS = 28;
const DAY_MS = 86_400_000;

const refreshWindow = (time: number): number => Math.floor(time / (REFRESH_DAYS * DAY_MS));

// Each full run reuses what the run before it restored, so a cap on the restored run's age alone caps nothing.
// Windows fixed from the epoch cap the whole chain: every state in a window was built from runs in that window.
export function inRefreshWindow(createdAt: string, now: number): boolean {
  return refreshWindow(Date.parse(createdAt)) === refreshWindow(now);
}

export type FullRun = { readonly databaseId: number; readonly createdAt: string };

const decodeHeadSha = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ headSha: Schema.String })));

const viewedHead = Effect.fn("viewedHead")(function* (run: number) {
  return (yield* gh(["run", "view", String(run), "--json", "headSha"]).pipe(Effect.flatMap(decodeHeadSha))).headSha;
});

export const pruneFullState = Effect.fn("pruneFullState")(function* (run: FullRun, state: string) {
  const fs = yield* FileSystem.FileSystem;
  if (!(yield* fs.exists(state))) return;
  const override = yield* Config.Int("CHECKS_MUTATION_BASELINE_NOW_MS").pipe(Config.option);
  let now = yield* Clock.currentTimeMillis;
  if (Option.isSome(override)) now = override.value;
  if (!inRefreshWindow(run.createdAt, now)) {
    yield* fs.remove(state);
    yield* Console.log(`mutation-baseline: dropped the restored full state, run ${run.databaseId} started before the current ${REFRESH_DAYS}-day refresh window`);
    return;
  }
  const base = yield* viewedHead(run.databaseId);
  const { paths, preload, stale, config } = yield* stalenessSince(base, "HEAD");
  const changed = [...paths].filter((path) => FULL_CONFIGS.includes(path) || config.has(path)).toSorted();
  if (changed.length > 0 || preload !== undefined) {
    yield* fs.remove(state);
    yield* Console.log(`mutation-baseline: dropped the restored full state, ${preload ?? changed.join(" ")} changed since run ${run.databaseId}`);
    return;
  }
  const text = yield* fs.readFileString(state);
  const stateJson: unknown = yield* Effect.try({
    try: (): unknown => JSON.parse(text),
    catch: () => new BaselineFailure({ message: `${state} is not a Stryker incremental state with its test files` }),
  });
  const stripped = withoutStale(stateJson, { tests: new Set(stale), sources: paths });
  if (stripped.tests.length === 0 && stripped.sources.length === 0) return;
  yield* fs.writeFileString(state, JSON.stringify(stripped.state));
  const dropped = [...stripped.tests, ...stripped.sources.map((source) => `${source} results`)].join(" ");
  yield* Console.log(`mutation-baseline: dropped ${dropped} from the restored full state`);
});
