import { bunStep, runStepsMain } from "./run-steps.ts";

runStepsMain([
  bunStep(
    "src/dependencies/vendor.ts",
    "--library",
    "effect",
    "--package",
    "effect",
    "--repository",
    "https://github.com/Effect-TS/effect.git",
    "--tag",
    "effect@{version}",
    "--path",
    "packages/effect/package.json",
  ),
  bunStep("scripts/self-bins.ts"),
]);
