import { describe, expect, test } from "bun:test";
import { type CommitStatus, stateOf, statusArgs } from "../../../../../src/delivery/ci/lib/commit-status.ts";

const STATUS: CommitStatus = {
  repository: "acme/acme",
  sha: "0123456789abcdef0123456789abcdef01234567",
  state: "success",
  context: "commitlint",
  description: "",
  targetUrl: "https://github.com/acme/acme/actions/runs/42",
};

describe("stateOf", () => {
  test("an outcome other than success read as success, or success read as failure, fails", () => {
    expect(stateOf("success")).toBe("success");
    expect(stateOf("failure")).toBe("failure");
    expect(stateOf("cancelled")).toBe("failure");
    expect(stateOf("skipped")).toBe("failure");
    expect(stateOf("")).toBe("failure");
  });
});

describe("a cancelled job", () => {
  test("a cancelled job posted as anything but a failure status fails", () => {
    expect(statusArgs({ ...STATUS, state: stateOf("cancelled") })).toContain("state=failure");
  });
});

describe("statusArgs", () => {
  test("a status posted anywhere but the commit statuses endpoint, or with an empty description field, fails", () => {
    expect(statusArgs(STATUS)).toEqual([
      "api",
      "repos/acme/acme/statuses/0123456789abcdef0123456789abcdef01234567",
      "-f",
      "state=success",
      "-f",
      "context=commitlint",
      "-f",
      "target_url=https://github.com/acme/acme/actions/runs/42",
      "--silent",
    ]);
  });

  test("a description that never reaches the status, or that splits on its spaces, fails", () => {
    expect(statusArgs({ ...STATUS, description: "the chosen head and description" })).toContain("description=the chosen head and description");
  });
});
