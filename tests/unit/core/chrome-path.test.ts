import { expect, test } from "bun:test";
import { ConfigProvider, Effect, FileSystem, Layer } from "effect";
import { chromePath } from "../../../src/core/chrome-path.ts";

const MAC_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function lookup(env: Record<string, string>, present: readonly string[]): Promise<string> {
  const machine = Layer.merge(
    ConfigProvider.layer(ConfigProvider.fromEnv({ env })),
    FileSystem.layerNoop({ exists: (path) => Effect.succeed(present.includes(path)) }),
  );
  return Effect.runPromise(chromePath().pipe(Effect.provide(machine)));
}

test("CHROME_PATH wins even over an installed Chrome, rather than the first path found on disk", async () => {
  expect(await lookup({ CHROME_PATH: "/custom/chrome" }, [MAC_CHROME])).toBe("/custom/chrome");
});

test("an empty CHROME_PATH falls back to the installed Chrome, rather than launching an empty path", async () => {
  expect(await lookup({ CHROME_PATH: "" }, ["/usr/bin/chromium"])).toBe("/usr/bin/chromium");
});

test("macOS Chrome is taken before a Linux Chromium on the same machine, rather than the last path found", async () => {
  expect(await lookup({}, ["/usr/bin/chromium", MAC_CHROME])).toBe(MAC_CHROME);
});

test("no Chrome anywhere fails with ChromeNotFound naming each path tried, rather than returning an empty path", async () => {
  const failure = await lookup({}, []).then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(failure).toMatchObject({ _tag: "ChromeNotFound" });
  expect(String(failure)).toContain(`no Chrome at any of: ${MAC_CHROME}, /opt/google/chrome/chrome`);
});
