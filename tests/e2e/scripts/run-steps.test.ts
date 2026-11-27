import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { BunServices } from "@effect/platform-bun";
import { Effect } from "effect";
import { runSteps, type Step } from "../../../scripts/run-steps.ts";
import { useScratch } from "../lib/ci-command.ts";

const scratch = useScratch("run-steps");

const run = (steps: readonly Step[]) => Effect.runPromise(runSteps(steps).pipe(Effect.provide(BunServices.layer)));
const append = (word: string): Step => ["sh", "-c", `printf '%s\\n' ${word} >> "${scratch.at("log")}"`];

test("a chain that runs on past a failed step, or exits other than that step's code, fails", async () => {
  scratch.write("log", "");
  expect(await run([append("first"), ["sh", "-c", "exit 3"], append("after")])).toBe(3);
  expect(readFileSync(scratch.at("log"), "utf8")).toBe("first\n");
});

test("a chain that stops early or exits nonzero when every step passes fails", async () => {
  scratch.write("log", "");
  expect(await run([append("first"), append("second")])).toBe(0);
  expect(readFileSync(scratch.at("log"), "utf8")).toBe("first\nsecond\n");
});

test("a missing program that passes or reports other than the shell's 127 fails", async () => {
  expect(await run([["checks-run-steps-no-such-program"]])).toBe(127);
});
