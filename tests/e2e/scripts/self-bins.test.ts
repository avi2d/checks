import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, statSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { useScratch } from "../lib/ci-command.ts";

const SCRIPT = join(import.meta.dir, "../../../scripts/self-bins.ts");
const scratch = useScratch("self-bins");

test("a kit bin that runs an installed copy instead of the checkout, or changes a source's mode, fails", () => {
  mkdirSync(scratch.at("bin"), { recursive: true });
  mkdirSync(scratch.at("node_modules", ".bin"), { recursive: true });
  scratch.write("package.json", JSON.stringify({ name: "@avi2dg/checks", bin: { "checks-fixture": "bin/source.ts" } }));
  scratch.write("bin/source.ts", 'console.log("checkout", ...process.argv.slice(2));\n');
  scratch.write("installed", 'console.log("installed");\n');
  symlinkSync(scratch.at("installed"), scratch.at("node_modules", ".bin", "checks-fixture"));
  const modeBefore = statSync(scratch.at("bin", "source.ts")).mode;
  expect(Bun.spawnSync([process.execPath, SCRIPT], { cwd: scratch.at() }).exitCode).toBe(0);
  const result = Bun.spawnSync(["bunx", "--no-install", "checks-fixture", "argument"], { cwd: scratch.at() });
  expect(result.stdout.toString().trim()).toBe("checkout argument");
  expect(statSync(scratch.at("bin", "source.ts")).mode).toBe(modeBefore);
  expect(readFileSync(scratch.at("installed"), "utf8")).toBe('console.log("installed");\n');
});

test("a bin name that could leave node_modules/.bin that is written fails", () => {
  scratch.write("package.json", JSON.stringify({ bin: { "../escape": "source.ts" } }));
  expect(Bun.spawnSync([process.execPath, SCRIPT], { cwd: scratch.at() }).exitCode).not.toBe(0);
  expect(() => statSync(scratch.at("node_modules", "escape"))).toThrow();
});
