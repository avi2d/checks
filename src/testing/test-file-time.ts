import { Console, Effect } from "effect";
import { TEST_ENTRY_POINT } from "../core/gates.ts";
import { decodeSetting, TestFileMaxSeconds } from "../core/settings.ts";
import { fileSeconds } from "./test-report.ts";

const DEFAULT_MAX_SECONDS = 300;

export const resolveTestFileMaxSeconds = Effect.fn("resolveTestFileMaxSeconds")(function* (configured: unknown) {
  if (configured === undefined) return DEFAULT_MAX_SECONDS;
  return yield* decodeSetting("testFileMaxSeconds", TestFileMaxSeconds, configured);
});

export const judgeTestFileTimes = Effect.fn("judgeTestFileTimes")(function* (xml: string, maxSeconds: number) {
  const slowFiles = [...(yield* fileSeconds(xml))].filter(([, seconds]) => seconds > maxSeconds);
  for (const [file, seconds] of slowFiles) {
    yield* Console.error(`${TEST_ENTRY_POINT.bin}: ${file} took ${seconds}s (limit ${maxSeconds}s)`);
  }
  return slowFiles.length === 0;
});
