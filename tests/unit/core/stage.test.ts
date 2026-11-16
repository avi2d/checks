import { expect, test } from "bun:test";
import { KIT_GATES } from "../../../src/core/gates.ts";
import { isDeclaredGate, parseStage, readsBuildOutput } from "../../../src/core/stage.ts";

const TRACKED = ["README.md", "src/content/blog/first.md", "src/pages/index.astro"];

test("an input over the built pages reads build output, while an input matching tracked copy does not count as build output", () => {
  expect(readsBuildOutput(["dist/**/*.html"], TRACKED)).toBe(true);
  expect(readsBuildOutput(["src/content/**/*.md"], TRACKED)).toBe(false);
  expect(readsBuildOutput(["src/content/**/*.md", "dist/**/*.html"], TRACKED)).toBe(true);
});

test("a brace glob over tracked copy reads source, rather than build output as a pathspec match would decide", () => {
  expect(readsBuildOutput(["src/**/*.{md,astro}"], TRACKED)).toBe(false);
});

test("only the gates that read inputs a repository declares can read build output, so no range gate leaves the source stage", () => {
  expect(KIT_GATES.filter(isDeclaredGate).map((gate) => gate.bin)).toEqual(["checks-frontend-syntax", "checks-copy"]);
});

test("parseStage takes the stage after --stage and keeps every other argument, rather than running every gate", () => {
  expect(parseStage([])).toEqual({ stage: undefined, rest: [] });
  expect(parseStage(["--stage", "source", "--full"])).toEqual({ stage: "source", rest: ["--full"] });
  expect(parseStage(["base", "--stage", "built", "head"])).toEqual({ stage: "built", rest: ["base", "head"] });
});

test("parseStage refuses an unknown stage, a missing one and a second --stage instead of guessing", () => {
  expect(parseStage(["--stage", "after"])).toBeUndefined();
  expect(parseStage(["--stage"])).toBeUndefined();
  expect(parseStage(["--stage", "source", "--stage", "built"])).toBeUndefined();
});
