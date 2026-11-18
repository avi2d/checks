import { Config, Console, Data, Duration, Effect } from "effect";
import { retryWithGrowingWait } from "./lib/retry.ts";
import { commandOutput, commandPassesWithin } from "./lib/run.ts";

const ATTEMPTS = 3;
const WAIT = Duration.seconds(10);
const ATTEMPT_LIMIT = Duration.seconds(180);
const NOTHING_MISSING = "All system dependencies are installed.";

class PlaywrightInputError extends Data.TaggedError("PlaywrightInputError")<{ readonly message: string }> {}

type Subcommand = "install" | "install-deps";

export function browsersOf(input: string): Effect.Effect<readonly string[], PlaywrightInputError> {
  const browsers = input.split(/\s+/).filter((browser) => browser !== "");
  return browsers.length === 0 ? Effect.fail(new PlaywrightInputError({ message: "browsers names no browser" })) : Effect.succeed(browsers);
}

// A playwright-core that only prints the apt-get command on a dry run exits 0 too, so the exit code alone decides nothing.
export function holdsSystemPackages(dryRun: { readonly stdout: string; readonly passed: boolean }): boolean {
  return dryRun.passed && dryRun.stdout.split("\n").includes(NOTHING_MISSING);
}

const installBrowsers = Effect.fn("installBrowsers")(function* (subcommand: Subcommand, browsers: readonly string[]) {
  const passed = yield* retryWithGrowingWait(commandPassesWithin("bunx", ["playwright-core", subcommand, ...browsers], ATTEMPT_LIMIT), {
    attempts: ATTEMPTS,
    wait: WAIT,
    onRetry: (attempt) => Console.log(`playwright-core ${subcommand} attempt ${attempt} failed or stalled, retrying`),
  });
  if (!passed) {
    yield* Console.log(`::error::playwright-core ${subcommand} failed or stalled on all ${ATTEMPTS} attempts, each stopped at ${Duration.format(ATTEMPT_LIMIT)}`);
  }
  return passed;
});

const installSystemPackages = Effect.fn("installSystemPackages")(function* (browsers: readonly string[]) {
  const dryRun = yield* commandOutput("bunx", ["playwright-core", "install-deps", "--dry-run", ...browsers]);
  yield* Console.log(dryRun.stdout.trimEnd());
  if (!holdsSystemPackages(dryRun)) return yield* installBrowsers("install-deps", browsers);
  yield* Console.log("the machine already holds the system packages, so apt-get does not run");
  return true;
});

export const main = Effect.fn("playwright")(function* (mode: string | undefined) {
  const browsers = yield* browsersOf(yield* Config.String("BROWSERS").pipe(Config.withDefault("")));
  if (mode === "install") return yield* installBrowsers(mode, browsers);
  if (mode === "install-deps") return yield* installSystemPackages(browsers);
  return yield* new PlaywrightInputError({ message: `playwright takes install or install-deps, not ${mode ?? "nothing"}` });
});
