import { expect, test } from "bun:test";
import { servedCommitOf } from "../../../../../src/delivery/ci/lib/cloudflare.ts";

const SERVED = {
  id: "d1",
  environment: "production",
  latest_stage: { name: "deploy", status: "success" },
  deployment_trigger: { metadata: { branch: "main", commit_hash: "abc1234" } },
};

test("a production deployment that finished deploying read as serving no commit fails", () => {
  expect(servedCommitOf(SERVED)).toBe("abc1234");
});

test.each([
  ["a preview deployment", { ...SERVED, environment: "preview" }],
  ["a deployment still building", { ...SERVED, latest_stage: { name: "build", status: "active" } }],
  ["a failed deploy", { ...SERVED, latest_stage: { name: "deploy", status: "failure" } }],
  ["a deployment without a commit", { ...SERVED, deployment_trigger: { metadata: { branch: "main", commit_hash: "" } } }],
  ["no deployment", null],
])("%s read as the served commit passes", (_, canonical) => {
  expect(servedCommitOf(canonical)).toBeUndefined();
});
