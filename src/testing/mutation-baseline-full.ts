import { Console, Effect, FileSystem, Schema } from "effect";
import { ChildProcessSpawner } from "effect/process";
import { collect } from "../core/git.ts";
import { isRecord, withoutStale } from "./mutation-baseline-saved.ts";
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

const parsedJson = (text: string) =>
  Effect.try({
    try: (): unknown => JSON.parse(text),
    catch: () => new BaselineFailure({ message: "package.json is not JSON" }),
  });

const withoutVersion = (text: string) =>
  parsedJson(text).pipe(
    Effect.map((parsed) => {
      if (!isRecord(parsed)) return undefined;
      return JSON.stringify(Object.fromEntries(Object.entries(parsed).filter(([key]) => key !== "version")));
    }),
    Effect.catchTag("BaselineFailure", () => Effect.succeed(undefined)),
  );

const patchedPaths = (text: string | undefined): Effect.Effect<readonly string[], BaselineFailure> => {
  if (text === undefined) return Effect.succeed([]);
  return parsedJson(text).pipe(
    Effect.map((parsed) => {
      if (!isRecord(parsed)) return [];
      const patched = parsed["patchedDependencies"];
      if (!isRecord(patched)) return [];
      return Object.values(patched).flatMap((value) => (typeof value === "string" ? [value.replace(/^\.\//, "")] : []));
    }),
    Effect.catchTag("BaselineFailure", (): Effect.Effect<readonly string[]> => Effect.succeed([])),
  );
};

const shownAt = (rev: string, path: string) =>
  collect("git", ["show", `${rev}:${path}`]).pipe(
    Effect.map(({ stdout, exitCode }) => (exitCode === ChildProcessSpawner.ExitCode(0) ? stdout : undefined)),
    Effect.mapError((cause) => new BaselineFailure({ message: cause.message })),
    Effect.catchTag("BaselineFailure", () => Effect.succeed(undefined)),
  );

const packageInputs = Effect.fn("packageInputs")(function* (base: string, head: string, paths: ReadonlySet<string>) {
  const inputs = new Set<string>();
  const [before, after] = yield* Effect.all([shownAt(base, "package.json"), shownAt(head, "package.json")]);
  if (paths.has("package.json") && (before === undefined || after === undefined || (yield* withoutVersion(before)) !== (yield* withoutVersion(after))))
    inputs.add("package.json");
  for (const text of [before, after]) for (const path of yield* patchedPaths(text)) if (paths.has(path)) inputs.add(path);
  return inputs;
});

const decodeHeadSha = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ headSha: Schema.String })));

const viewedHead = Effect.fn("viewedHead")(function* (run: number) {
  return (yield* gh(["run", "view", String(run), "--json", "headSha"]).pipe(Effect.flatMap(decodeHeadSha))).headSha;
});

export const pruneFullState = Effect.fn("pruneFullState")(function* (run: number, state: string) {
  const fs = yield* FileSystem.FileSystem;
  if (!(yield* fs.exists(state))) return;
  const base = yield* viewedHead(run);
  const { paths, preload, stale, config } = yield* stalenessSince(base, "HEAD");
  const inputs = yield* packageInputs(base, "HEAD", paths);
  const changed = [...paths].filter((path) => FULL_CONFIGS.includes(path) || inputs.has(path) || config.has(path)).toSorted();
  if (changed.length > 0 || preload !== undefined) {
    yield* fs.remove(state);
    yield* Console.log(`mutation-baseline: dropped the restored full state, ${preload ?? changed.join(" ")} changed since run ${run}`);
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
