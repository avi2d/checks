import { Console, Duration, Effect, Schema } from "effect";
import { builtFiles } from "./lib/built-files.ts";
import { requiredInput } from "./lib/inputs.ts";
import { parseAttempts } from "./lib/retry.ts";
import { readUntil } from "./lib/wait.ts";

const ACTION = "pages-served";
const CONCURRENT_FETCHES = 8;
const HOST_CONFIG = new Set(["_headers", "_redirects", "_routes.json", "_worker.js", ".nojekyll", "CNAME"]);

class NotServed extends Schema.TaggedError<NotServed>()("NotServed", {
  message: Schema.String,
}) {}

export function servedPaths(files: readonly string[]): readonly string[] {
  return files.filter((file) => !HOST_CONFIG.has(file)).toSorted();
}

export function addressOf(file: string): string {
  if (file === "index.html") return "/";
  if (file.endsWith("/index.html")) return `/${file.slice(0, -"index.html".length)}`;
  return `/${file}`;
}

export function originOf(named: string): Effect.Effect<string, NotServed> {
  if (!URL.canParse(named) || new URL(named).protocol !== "https:") {
    return Effect.fail(new NotServed({ message: `origin must be an https address such as https://example.com, not '${named}'` }));
  }
  return Effect.succeed(new URL(named).origin);
}

export function sameBytes(built: Uint8Array, served: Uint8Array): boolean {
  return built.length === served.length && built.every((byte, index) => byte === served[index]);
}

// A fresh query on each try keeps a cache in front of the host from answering with the bytes it held before the deploy.
export function freshAddress(origin: string, file: string, attempt: number): string {
  const path = addressOf(file).split("/").map(encodeURIComponent).join("/");
  return `${origin}${path}?served-check=${String(attempt)}-${String(Date.now())}`;
}

const servedBytes = (address: string) =>
  Effect.tryPromise(() =>
    fetch(address, { redirect: "follow" })
      .then((response) => response.arrayBuffer())
      .then((buffer) => new Uint8Array(buffer)),
  ).pipe(
    Effect.catchTag("UnknownError", () => Effect.succeed(new Uint8Array())),
  );

const differing = (root: string, origin: string, files: readonly string[], attempt: number) =>
  Effect.forEach(
    files,
    (file) =>
      Effect.gen(function* () {
        const built = new Uint8Array(yield* Effect.promise(() => Bun.file(`${root}/${file}`).arrayBuffer()));
        return sameBytes(built, yield* servedBytes(freshAddress(origin, file, attempt))) ? [] : [file];
      }),
    { concurrency: CONCURRENT_FETCHES },
  ).pipe(Effect.map((found) => found.flat()));

export const main = Effect.gen(function* () {
  const directory = yield* requiredInput(ACTION, "directory", "DIRECTORY");
  const origin = yield* originOf(yield* requiredInput(ACTION, "origin", "ORIGIN"));
  const attempts = yield* parseAttempts(yield* requiredInput(ACTION, "attempts", "ATTEMPTS"));
  const { root, files } = yield* builtFiles("directory", directory);
  const paths = servedPaths(files);
  if (paths.length === 0) return yield* new NotServed({ message: `directory names ${directory}, which holds no file to check` });
  let attempt = 0;
  let remaining: readonly string[] = paths;
  const left = yield* readUntil(
    Effect.suspend(() => {
      attempt += 1;
      return differing(root, origin, remaining, attempt).pipe(
        Effect.tap((found) => {
          remaining = found;
          return found.length === 0 ? Effect.void : Console.log(`try ${String(attempt)}: ${origin} serves ${String(found.length)} of ${String(paths.length)} files unlike the build`);
        }),
      );
    }),
    (found) => found.length === 0,
    attempts,
    Duration.seconds(10),
  );
  if (left.length > 0) {
    return yield* new NotServed({ message: `after ${String(attempts)} tries ${origin} still serves these files unlike the build: ${left.slice(0, 20).join(", ")}` });
  }
  yield* Console.log(`${origin} serves all ${String(paths.length)} files of ${directory} as built`);
  return true;
});
