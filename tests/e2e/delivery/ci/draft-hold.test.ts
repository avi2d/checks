import { beforeEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync } from "node:fs";
import { CI_MAIN, useScratch } from "../../lib/ci-command.ts";

const CANCEL = "api --method POST repos/owner/site/actions/runs/77/cancel\n";
const scratch = useScratch("draft-hold");

beforeEach(() => {
  mkdirSync(scratch.at("bin"));
});

function stubGh(script: string): void {
  scratch.write("bin/gh", `#!/bin/sh\necho "$*" >> "${scratch.at("calls")}"\n${script}\n`);
  chmodSync(scratch.at("bin/gh"), 0o755);
}

type Run = { readonly event: string; readonly draft: string; readonly attempt: string };

function hold(run: Run) {
  const result = Bun.spawnSync([process.execPath, CI_MAIN, "draft-hold"], {
    env: {
      PATH: `${scratch.at("bin")}:${process.env["PATH"] ?? ""}`,
      GITHUB_REPOSITORY: "owner/site",
      GITHUB_RUN_ID: "77",
      GITHUB_EVENT_NAME: run.event,
      DRAFT: run.draft,
      GITHUB_RUN_ATTEMPT: run.attempt,
      WAIT_SECONDS: "0",
    },
  });
  return { exitCode: result.exitCode, stdout: result.stdout.toString(), calls: scratch.read("calls") };
}

test("a push to a draft that leaves its run alone, or passes a job that outlives the cancel, fails", () => {
  stubGh("exit 0");
  const held = hold({ event: "pull_request", draft: "true", attempt: "1" });
  expect(held).toMatchObject({ exitCode: 1, calls: CANCEL });
  expect(held.stdout).toContain("::notice::The pull request is a draft, so its checks wait.");
});

test("a push to a ready pull request that cancels its run fails", () => {
  stubGh("exit 0");
  expect(hold({ event: "pull_request", draft: "false", attempt: "1" })).toMatchObject({ exitCode: 0, calls: "" });
});

test("a run someone started by hand on a draft that cancels itself again fails", () => {
  stubGh("exit 0");
  expect(hold({ event: "pull_request", draft: "true", attempt: "2" })).toMatchObject({ exitCode: 0, calls: "" });
});

test("a dispatched run, which carries no pull request, that cancels itself fails", () => {
  stubGh("exit 0");
  expect(hold({ event: "workflow_dispatch", draft: "", attempt: "1" })).toMatchObject({ exitCode: 0, calls: "" });
});

test("a refused cancel that fails the job, where the checks should run, fails", () => {
  stubGh("exit 1");
  const refused = hold({ event: "pull_request", draft: "true", attempt: "1" });
  expect(refused).toMatchObject({ exitCode: 0, calls: CANCEL });
  expect(refused.stdout).toContain("::warning::draft-hold could not cancel this run");
});
