import { expect, test } from "bun:test";
import { recordedCalls, runCi, stubBin, useScratch } from "../../lib/ci-command.ts";

const scratch = useScratch("playwright");
const MAIN = "playwright";
const DRY_RUN = ["playwright-core", "install-deps", "--dry-run", "webkit", "chromium"];
const INSTALL = ["playwright-core", "install-deps", "webkit", "chromium"];
const BUNX_ANSWERS_THE_DRY_RUN = `case " $* " in *" --dry-run "*) printf '%s\\n' "$DRY_RUN_STDOUT"; exit "$DRY_RUN_EXIT" ;; esac`;

function installDeps(dryRun: { readonly stdout: string; readonly exitCode: number }) {
  stubBin(scratch.at("bin"), "bunx", BUNX_ANSWERS_THE_DRY_RUN);
  return runCi(MAIN, ["install-deps"], {
    PATH: `${scratch.at("bin")}:${process.env["PATH"] ?? ""}`,
    STUB_RECORD: scratch.at("calls"),
    BROWSERS: "webkit chromium",
    DRY_RUN_STDOUT: dryRun.stdout,
    DRY_RUN_EXIT: String(dryRun.exitCode),
  });
}

test("browsers installed other than by one playwright-core install through bunx fail", async () => {
  stubBin(scratch.at("bin"), "bunx", "exit 0");
  const ran = await runCi(MAIN, ["install"], {
    PATH: `${scratch.at("bin")}:${process.env["PATH"] ?? ""}`,
    STUB_RECORD: scratch.at("calls"),
    BROWSERS: "webkit chromium",
  });
  expect(ran.exitCode).toBe(0);
  expect(recordedCalls(scratch.at("calls"))).toEqual([["playwright-core", "install", "webkit", "chromium"]]);
});

test("a machine that holds every system package and still has apt-get run fails", async () => {
  const ran = await installDeps({ stdout: "All system dependencies are installed.", exitCode: 0 });
  expect(ran.exitCode).toBe(0);
  expect(recordedCalls(scratch.at("calls"))).toEqual([DRY_RUN]);
});

test("a machine that misses system packages and gets none installed fails", async () => {
  const ran = await installDeps({ stdout: "Missing system dependencies (1):\n  libwoff1", exitCode: 1 });
  expect(ran.exitCode).toBe(0);
  expect(recordedCalls(scratch.at("calls"))).toEqual([DRY_RUN, INSTALL]);
});
