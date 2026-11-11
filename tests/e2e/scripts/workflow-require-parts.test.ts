import { expect, test } from "bun:test";
import { join } from "node:path";
import { $ } from "bun";
import { CHECKOUT, ran } from "../lib/fixture-repo.ts";

const script = join(CHECKOUT, "scripts", "workflow-require-parts.sh");

test("the required job rejects a failed part and an unexplained e2e skip", async () => {
  const success = { CHANGES: "success", UNIT: "success", STATIC: "success", E2E: "success", E2E_SKIP: "false" };
  for (const env of [
    { ...success, CHANGES: "failure" },
    { ...success, UNIT: "failure" },
    { ...success, STATIC: "failure" },
    { ...success, E2E: "failure" },
    { ...success, E2E: "skipped" },
  ]) {
    expect((await ran($`bash ${script}`.env(env))).exitCode).toBe(1);
  }
  expect((await ran($`bash ${script}`.env(success))).exitCode).toBe(0);
  expect((await ran($`bash ${script}`.env({ ...success, E2E: "skipped", E2E_SKIP: "true" }))).exitCode).toBe(0);
});
