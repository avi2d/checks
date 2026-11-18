import { beforeEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync } from "node:fs";
import { CI_MAIN, useScratch } from "../../lib/ci-command.ts";

const HEAD = "0123456789abcdef0123456789abcdef01234567";
const RUN_SHA = "fedcba9876543210fedcba9876543210fedcba98";
const scratch = useScratch("commit-status");

beforeEach(() => {
  mkdirSync(scratch.at("bin"));
});

function stubGh(pullHead: string): void {
  scratch.write("bin/gh", `#!/bin/sh\necho "$*" >> "${scratch.at("calls")}"\ncase "$2" in */pulls/*) echo "${pullHead}" ;; esac\n`);
  chmodSync(scratch.at("bin/gh"), 0o755);
}

function report(inputs: Readonly<Record<string, string | undefined>>) {
  const env: Record<string, string | undefined> = {
    PATH: `${scratch.at("bin")}:${process.env["PATH"] ?? ""}`,
    GITHUB_REPOSITORY: "owner/repo",
    GITHUB_SHA: RUN_SHA,
    GITHUB_SERVER_URL: "https://github.com",
    GITHUB_RUN_ID: "42",
    JOB_STATUS: "success",
    CONTEXT: "pr-text",
    ATTEMPTS: "1",
    ...inputs,
  };
  const result = Bun.spawnSync([process.execPath, CI_MAIN, "commit-status"], {
    env: Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined)),
  });
  return { exitCode: result.exitCode, calls: scratch.read("calls").trim().split("\n") };
}

const status = (sha: string) => `api repos/owner/repo/statuses/${sha} -f state=success -f context=pr-text -f target_url=https://github.com/owner/repo/actions/runs/42 --silent`;

test("a status that lands anywhere but the pull request's head fails", () => {
  stubGh(HEAD);
  expect(report({ PULL_REQUEST: "7" })).toEqual({ exitCode: 0, calls: ["api repos/owner/repo/pulls/7 --jq .head.sha", status(HEAD)] });
});

test("a head-sha that loses to the pull request's head fails", () => {
  stubGh(HEAD);
  const chosen = RUN_SHA.replace("f", "e");
  expect(report({ HEAD_SHA: chosen, PULL_REQUEST: "7" })).toEqual({ exitCode: 0, calls: [status(chosen)] });
});

test("a run with neither head-sha nor pull-request that leaves GITHUB_SHA fails", () => {
  stubGh(HEAD);
  expect(report({})).toEqual({ exitCode: 0, calls: [status(RUN_SHA)] });
});

test.each([
  ["a head that is no full commit SHA", "7", "abc1234"],
  ["a pull request that is no number", "7; echo", HEAD],
])("%s that still posts a status passes", (_, pullRequest, pullHead) => {
  stubGh(pullHead);
  const { exitCode, calls } = report({ PULL_REQUEST: pullRequest });
  expect(exitCode).toBe(1);
  expect(calls.some((call) => call.includes("/statuses/"))).toBe(false);
});

test("a head read that fails once and posts no status without a retry fails", () => {
  const marker = scratch.at("flaked");
  scratch.write("bin/gh", `#!/bin/sh\necho "$*" >> "${scratch.at("calls")}"\ncase "$2" in */pulls/*) if [ ! -f "${marker}" ]; then touch "${marker}"; echo "boom"; exit 1; fi; echo "${HEAD}" ;; esac\n`);
  chmodSync(scratch.at("bin/gh"), 0o755);
  expect(report({ PULL_REQUEST: "7", ATTEMPTS: "2" })).toEqual({
    exitCode: 0,
    calls: ["api repos/owner/repo/pulls/7 --jq .head.sha", "api repos/owner/repo/pulls/7 --jq .head.sha", status(HEAD)],
  });
}, 30000);

test("an unset ATTEMPTS no longer fails: the pull request's head gets its status with one try", () => {
  stubGh(HEAD);
  expect(report({ PULL_REQUEST: "7", ATTEMPTS: undefined })).toEqual({ exitCode: 0, calls: ["api repos/owner/repo/pulls/7 --jq .head.sha", status(HEAD)] });
});

test("an empty ATTEMPTS that reads as unset and posts a status fails", () => {
  stubGh(HEAD);
  const { exitCode, calls } = report({ PULL_REQUEST: "7", ATTEMPTS: "" });
  expect({ exitCode, posted: calls.some((call) => call.includes("/statuses/")) }).toEqual({ exitCode: 1, posted: false });
});
