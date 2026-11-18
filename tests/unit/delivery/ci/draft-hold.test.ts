import { expect, test } from "bun:test";
import { holdReason } from "../../../../src/delivery/ci/draft-hold.ts";

test("a first push to a draft pull request that runs the checks fails", () => {
  expect(holdReason({ event: "pull_request", draft: "true", attempt: "1" })).toBeUndefined();
  expect(holdReason({ event: "pull_request_target", draft: "true", attempt: "1" })).toBeUndefined();
});

test.each([
  [{ event: "workflow_dispatch", draft: "", attempt: "1" }, "a workflow_dispatch run is no push to a draft"],
  [{ event: "pull_request", draft: "false", attempt: "1" }, "the pull request is ready for review"],
  [{ event: "pull_request", draft: "true", attempt: "2" }, "someone started attempt 2 of this run by hand"],
])("a run of %p that holds its checks fails", (run, reason) => {
  expect(holdReason(run)).toBe(reason);
});
