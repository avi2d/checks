import { expect, test } from "bun:test";
import { Effect } from "effect";
import { ChildProcess } from "effect/process";
import { outputOf } from "../../../src/core/command-output.ts";
import { run } from "../../../src/testing/run-effect.ts";

test("a command exiting 3 succeeds with its code and both outputs apart, rather than failing or merging the streams", async () => {
  const ran = await run(outputOf(ChildProcess.make("sh", ["-c", "printf out; printf err >&2; exit 3"])));
  expect(ran).toEqual({ code: 3, stdout: "out", stderr: "err" });
});

test("a command filling both pipes past their buffers finishes, rather than stalling on the pipe left unread", async () => {
  const flood = "head -c 1000000 /dev/zero | tr '\\0' e >&2; head -c 1000000 /dev/zero | tr '\\0' o";
  const ran = await run(outputOf(ChildProcess.make("sh", ["-c", flood])).pipe(Effect.timeout("20 seconds")));
  expect([ran.code, ran.stdout.length, ran.stderr.length]).toEqual([0, 1_000_000, 1_000_000]);
});
