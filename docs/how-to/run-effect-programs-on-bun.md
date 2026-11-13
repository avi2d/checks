---
kind: how-to
audience: consumers
---
# Run Effect programs on Bun

A repository owner follows these steps to run an Effect script or test on Bun with the kit's helpers instead of a copy of them in each repository.

## Before you begin

- `effect` installed at the version the kit's `package.json` lists among its `peerDependencies`.

## Run a script

To run a script as a Bun entry point:

1. Import `main` and pass it the program:

   ```ts
   import { Console, Effect } from "effect";
   import { main } from "@avi2dg/checks/core/bun-platform.ts";

   main(Effect.gen(function* () {
     yield* Console.log("built");
   }));
   ```

1. Run `bun scripts/build.ts`.

`main` provides `platform`, which holds Bun's child process spawner, file system and path services.
`Platform` is the type of those services, for a program's requirements.
A failure prints its cause to stderr and exits with code 1, so stdout holds only what the script prints.
An interruption alone prints nothing.

## Run a program inside a test

To run an Effect program from a Bun test:

1. Import `run`, which provides `platform` and returns a promise of the program's value:

   ```ts
   import { expect, test } from "bun:test";
   import { Effect, FileSystem } from "effect";
   import { run } from "@avi2dg/checks/testing/run-effect.ts";

   const indexWritten = Effect.gen(function* () {
     const fs = yield* FileSystem.FileSystem;
     return yield* fs.exists("dist/index.html");
   });

   test("the build writes its index", async () => {
     expect(await run(indexWritten)).toBe(true);
   });
   ```

The promise rejects when the program fails.

## Read a command's output

To run a command and read what it printed:

1. Import `outputOf` and pass it a command:

   ```ts
   import { Console, Effect } from "effect";
   import { ChildProcess } from "effect/process";
   import { outputOf } from "@avi2dg/checks/core/command-output.ts";

   const status = Effect.gen(function* () {
     const { code, stdout } = yield* outputOf(ChildProcess.make("git", ["status", "--short"]));
     if (code === 0) yield* Console.log(stdout);
   });
   ```

`outputOf` reads stdout and stderr while the command runs, and returns them as text with the exit code.
A command that exits with a code other than 0 still succeeds, so the caller decides what the code means.
Its result has the type `Ran`.

## Find Chrome

To launch the Chrome the machine already has:

1. Import `chromePath` and pass its result to the browser launch:

   ```ts
   import { chromium } from "playwright-core";
   import { chromePath } from "@avi2dg/checks/core/chrome-path.ts";
   import { run } from "@avi2dg/checks/testing/run-effect.ts";

   const browser = await chromium.launch({ executablePath: await run(chromePath()) });
   ```

`chromePath` returns `CHROME_PATH` when it is set and not empty.
Otherwise it returns the first of these that exists:

- `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
- `/opt/google/chrome/chrome`
- `/usr/bin/google-chrome`
- `/usr/bin/chromium-browser`
- `/usr/bin/chromium`

## Troubleshooting

### ChromeNotFound: no Chrome at any of

None of the paths above exists and `CHROME_PATH` is not set.
Install Chrome, or set `CHROME_PATH` to its executable.

## Related topics

- [Test a built site in a browser](test-a-built-site.md)
