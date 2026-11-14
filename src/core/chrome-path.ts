import { Config, Effect, FileSystem, Schema, type PlatformError } from "effect";

export class ChromeNotFound extends Schema.TaggedError<ChromeNotFound>()("ChromeNotFound", {
  message: Schema.String,
}) {}

const CHROME_CANDIDATES: readonly string[] = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/opt/google/chrome/chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
];

export const chromePath = Effect.fnUntraced(function* (): Effect.fn.Return<
  string,
  ChromeNotFound | Config.ConfigError | PlatformError.PlatformError,
  FileSystem.FileSystem
> {
  const override = yield* Config.String("CHROME_PATH").pipe(Config.withDefault(""));
  if (override !== "") return override;
  const fs = yield* FileSystem.FileSystem;
  for (const candidate of CHROME_CANDIDATES) {
    if (yield* fs.exists(candidate)) return candidate;
  }
  return yield* new ChromeNotFound({ message: `no Chrome at any of: ${CHROME_CANDIDATES.join(", ")}` });
});
