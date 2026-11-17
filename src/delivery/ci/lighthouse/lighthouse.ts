import { Config, Console, Data, Duration, Effect, FileSystem, Option, Path, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { optionalInput, requiredInput } from "../lib/inputs.ts";
import { readUntil } from "../lib/wait.ts";
import { retryWithGrowingWait } from "../lib/retry.ts";
import { commandPasses, commandPassesWithin } from "../lib/run.ts";
import { CATEGORY_IDS, type PageScores, Report, reportName, type Scores, scoresOf, summaryTable } from "./scores.ts";
import { builtFiles } from "../lib/built-files.ts";
import { auditOrigin, choosePages, pagesOf, routesOf, serveSite } from "./site.ts";

// The repository's own install holds no Lighthouse, so without a lighthouse input the audit installs and runs the one pinned beside this script.
const PINNED = new URL("./pinned", import.meta.url).pathname;
const PINNED_LIGHTHOUSE = `${PINNED}/node_modules/.bin/lighthouse`;

class LighthouseError extends Data.TaggedError("LighthouseError")<{ readonly message: string }> {}

const CHROME_NAMES = ["google-chrome-stable", "google-chrome", "chromium", "chromium-browser"];
const CHROME_FLAGS = [
  "--headless=new",
  "--no-sandbox",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-extensions",
  "--disable-component-update",
  "--disable-background-networking",
  "--disable-dev-shm-usage",
  "--remote-debugging-port=0",
];
const PORT_FILE = "DevToolsActivePort";
const PORT_TRIES = 300;
const PORT_WAIT = Duration.millis(100);
const ATTEMPTS = 3;
const RETRY_WAIT = Duration.seconds(5);
const RUN_LIMIT = Duration.minutes(2);

const decodeReport = Schema.decodeUnknownEffect(Schema.fromJsonString(Report));

export function parseRuns(text: string): Effect.Effect<number, LighthouseError> {
  return /^[1-9][0-9]*$/.test(text) ? Effect.succeed(Number(text)) : Effect.fail(new LighthouseError({ message: `runs must be a whole number from 1, not '${text}'` }));
}

const findChrome = Effect.fn("findChrome")(function* (named: string) {
  if (named !== "") {
    const fs = yield* FileSystem.FileSystem;
    if (yield* fs.exists(named)) return named;
    return yield* new LighthouseError({ message: `chrome-path names ${named}, which does not exist` });
  }
  const found = CHROME_NAMES.map((name) => Bun.which(name)).find((chrome) => chrome !== null);
  if (found === undefined) return yield* new LighthouseError({ message: `no ${CHROME_NAMES.join(", ")} is on the PATH, so pass chrome-path` });
  return found;
});

const firstLine = (text: string) => text.split("\n")[0] ?? "";

// chrome-launcher derives its profile folder from the machine's PATH under WSL and breaks there, so the command starts Chrome itself.
const startChrome = Effect.fn("startChrome")(function* (chrome: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const profile = yield* fs.makeTempDirectory({ prefix: "lighthouse-chrome-" });
  yield* Effect.addFinalizer(() => fs.remove(profile, { recursive: true }).pipe(Effect.catchTag("PlatformError", (error) => Console.log(`could not remove the Chrome profile ${profile}: ${error.message}`))));
  yield* spawner.spawn(ChildProcess.make(chrome, [...CHROME_FLAGS, `--user-data-dir=${profile}`, "about:blank"], { stdin: "ignore", stdout: "ignore", stderr: "ignore", forceKillAfter: Duration.seconds(5) }));
  const portFile = path.join(profile, PORT_FILE);
  const readPort = fs.readFileString(portFile).pipe(
    Effect.map(firstLine),
    Effect.orElseSucceed(() => ""),
  );
  const port = yield* readUntil(readPort, (line) => line !== "", PORT_TRIES, PORT_WAIT);
  if (port === "") return yield* new LighthouseError({ message: `Chrome wrote no debugging port to ${portFile}` });
  return port;
});

const auditOnce = Effect.fn("auditOnce")(
  function* (audit: Audit, url: string, reportPath: string) {
    const port = yield* startChrome(audit.chrome);
    return yield* commandPassesWithin(
      audit.lighthouse,
      [url, "--output=json", `--output-path=${reportPath}`, "--quiet", `--port=${port}`, `--only-categories=${CATEGORY_IDS.join(",")}`],
      RUN_LIMIT,
    );
  },
  Effect.scoped,
  Effect.catch((failure) => Console.log(`::warning::${failure.message}`).pipe(Effect.as(false))),
);

const auditPage = Effect.fn("auditPage")(function* (audit: Audit, url: string, reportPath: string) {
  yield* retryWithGrowingWait(auditOnce(audit, url, reportPath), {
    attempts: ATTEMPTS,
    wait: RETRY_WAIT,
    onRetry: (attempt) => Console.log(`lighthouse on ${url} attempt ${String(attempt)} failed, retrying`),
  });
  const fs = yield* FileSystem.FileSystem;
  const report = yield* fs.readFileString(reportPath).pipe(Effect.flatMap(decodeReport), Effect.option);
  if (Option.isSome(report)) return scoresOf(report.value);
  return yield* new LighthouseError({ message: `lighthouse wrote no report with the four category scores to ${reportPath} for ${url} in ${String(ATTEMPTS)} attempts` });
});

type Audit = { readonly chrome: string; readonly lighthouse: string };

const chooseLighthouse = Effect.fn("chooseLighthouse")(function* (named: string) {
  if (named !== "") return named;
  const installed = yield* commandPasses("bun", ["install", "--frozen-lockfile", "--production", "--ignore-scripts", "--cwd", PINNED]);
  if (!installed) return yield* new LighthouseError({ message: `bun install of the pinned Lighthouse in ${PINNED} failed` });
  return PINNED_LIGHTHOUSE;
});

export const main = Effect.gen(function* () {
  const site = yield* requiredInput("lighthouse", "site", "SITE");
  const runs = yield* parseRuns(yield* Config.String("RUNS").pipe(Config.withDefault("3")));
  const chrome = yield* findChrome(yield* optionalInput("CHROME"));
  const audit = { chrome, lighthouse: yield* chooseLighthouse(yield* optionalInput("LIGHTHOUSE")) };
  const reports = yield* Config.String("REPORTS");
  const { root, files } = yield* builtFiles("site", site);
  const pages = yield* choosePages(pagesOf(files), yield* optionalInput("PAGES"));
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(reports, { recursive: true });
  const live = yield* auditOrigin(yield* optionalInput("ORIGIN"));
  const origin = Option.isSome(live) ? live.value : yield* serveSite(root, routesOf(files));
  const results: PageScores[] = [];
  for (const [index, page] of pages.entries()) {
    const url = new URL(page, origin).href;
    const pageRuns: Scores[] = [];
    for (let run = 1; run <= runs; run += 1) {
      yield* Console.log(`lighthouse ${url} run ${String(run)} of ${String(runs)}`);
      pageRuns.push(yield* auditPage(audit, url, path.join(reports, reportName(index + 1, page, run))));
    }
    results.push({ page, runs: pageRuns });
  }
  const table = summaryTable(results, runs);
  yield* Console.log(table);
  yield* fs.writeFileString(yield* Config.String("GITHUB_STEP_SUMMARY"), table, { flag: "a" });
  return true;
}).pipe(Effect.scoped);
