import { Clock, Console, Duration, Effect } from "effect";
import { commandExitWatching } from "../lib/run.ts";

const STRYKER = "node_modules/.bin/stryker";
export const STOP_MINUTES = 30;
const STOP_BUDGET = Duration.minutes(STOP_MINUTES);
const DIAGNOSTIC = "stryker-bun-runner: dry run data-completeness check failed — ";
const LOST_END = "1 test(s) started but never reported a result: their TestReporter.end events were lost";
const PASS_COUNTS = /^bun's summary counts ([0-9]+) passing test\(s\), but the Bun inspector reported ([0-9]+): test events were lost or merged on the way from bun to the runner$/;
const ABNORMAL_CLOSE = /^the inspector WebSocket also closed unexpectedly \(close code=1006 reason="" wasClean=false, [0-9]+ms after the last received frame\), which is routine on its own and listed only as context$/;

function lostInspectorEnd(line: string): boolean {
  const start = line.indexOf(DIAGNOSTIC);
  const end = line.indexOf(". Completing this dry run", start);
  if (start === -1 || end === -1) return false;
  const [counts, lost, close, ...other] = line.slice(start + DIAGNOSTIC.length, end).split("; ");
  if (counts === undefined || lost !== LOST_END || close === undefined || other.length !== 0 || !ABNORMAL_CLOSE.test(close)) return false;
  const reported = PASS_COUNTS.exec(counts);
  return reported !== null && Number(reported[1]) - Number(reported[2]) === 1;
}

const attempt = (duration: string, mutate: string) =>
  commandExitWatching("timeout", ["-s", "TERM", duration, STRYKER, "run", "--incremental", "--mutate", mutate], lostInspectorEnd);

export const runShard = Effect.fn("runShard")(function* (mutate: string) {
  const started = yield* Clock.currentTimeNanos;
  const first = yield* attempt(`${STOP_MINUTES}m`, mutate);
  if (first.exitCode !== 1 || !first.matched) return first.exitCode;
  const elapsed = Duration.nanos((yield* Clock.currentTimeNanos) - started);
  const remainingMs = Math.floor(Duration.toMillis(STOP_BUDGET) - Duration.toMillis(elapsed));
  if (remainingMs <= 0) return first.exitCode;
  yield* Console.log("::notice::retrying the mutation dry run once after the Bun inspector lost a test result");
  return (yield* attempt(`${Duration.toSeconds(Duration.millis(remainingMs))}s`, mutate)).exitCode;
});
