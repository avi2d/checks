import { Console, Effect } from "effect";
import { TEST_ENTRY_POINT } from "../core/gates.ts";
import { decodeSetting, DEFAULT_TEST_FILE_MAX_SECONDS, settingPath, TestFileMaxSeconds } from "../core/settings.ts";
import { fileSeconds } from "./test-report.ts";

export const resolveTestFileMaxSeconds = Effect.fn("resolveTestFileMaxSeconds")(function* (configured: unknown, location = settingPath("testFileMaxSeconds")) {
  if (configured === undefined) return DEFAULT_TEST_FILE_MAX_SECONDS;
  return yield* decodeSetting("testFileMaxSeconds", TestFileMaxSeconds, configured, location);
});

export const judgeTestFileTimes = Effect.fn("judgeTestFileTimes")(function* (xml: string, maxSeconds: number) {
  const slowFiles = [...(yield* fileSeconds(xml))].filter(([, seconds]) => seconds > maxSeconds);
  for (const [file, seconds] of slowFiles) {
    yield* Console.error(`${TEST_ENTRY_POINT.bin}: ${file} took ${seconds}s (limit ${maxSeconds}s)`);
  }
  return slowFiles.length === 0;
});
