import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { CI_MAIN, useScratch } from "../../lib/ci-command.ts";
const NOTICE = "no private pack is configured, so the steps that read CHECKS_SECRETS_PACK skip";
const scratch = useScratch("secrets-pack");

function writePack(pack: string, ifMissing: string) {
  for (const file of ["env", "summary"]) scratch.write(file, "");
  const result = Bun.spawnSync([process.execPath, CI_MAIN, "secrets-pack"], {
    env: {
      PATH: process.env["PATH"] ?? "",
      PACK: pack,
      IF_MISSING: ifMissing,
      RUNNER_TEMP: scratch.at(),
      GITHUB_ENV: scratch.at("env"),
      GITHUB_OUTPUT: scratch.at("output"),
      GITHUB_STEP_SUMMARY: scratch.at("summary"),
    },
  });
  return { exitCode: result.exitCode, stdout: result.stdout.toString(), output: scratch.read("output"), env: scratch.read("env"), summary: scratch.read("summary") };
}

test("a skipped empty pack that fails, exports a path or reports configured, fails", () => {
  expect(writePack("", "skip")).toEqual({ exitCode: 0, stdout: `::notice::${NOTICE}\n`, output: "configured=false\n", env: "", summary: `${NOTICE}\n` });
  expect(readdirSync(scratch.at()).sort()).toEqual(["env", "output", "summary"]);
});

test("an empty pack that passes without if-missing skip fails", () => {
  expect(writePack("", "fail")).toMatchObject({ exitCode: 1, output: "", env: "" });
  expect(writePack("", "skipp")).toMatchObject({ exitCode: 1, output: "", env: "" });
});

test("a written pack that reports configured false, or a skip notice, fails", () => {
  expect(writePack('{"names":[]}', "skip")).toMatchObject({
    exitCode: 0,
    output: "configured=true\n",
    env: `CHECKS_SECRETS_PACK=${scratch.at("secrets-pack.json")}\n`,
    summary: "",
  });
});
