import { $ } from "bun";
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PLATFORM = join(import.meta.dir, "..", "..", "..", "src", "core", "bun-platform.ts");
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function script(body: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const dir = await mkdtemp(join(tmpdir(), "checks-bun-platform-"));
  dirs.push(dir);
  const file = join(dir, "script.ts");
  await writeFile(file, `import { Console, Effect, FileSystem } from ${JSON.stringify(Bun.resolveSync("effect", import.meta.dir))};\nimport { main } from ${JSON.stringify(PLATFORM)};\n${body}\n`);
  const ran = await $`bun ${file}`.nothrow().quiet();
  return { exitCode: ran.exitCode, stdout: ran.stdout.toString(), stderr: ran.stderr.toString() };
}

test("a script that succeeds prints only its answer on stdout, with the file system provided", async () => {
  const ran = await script(`main(Effect.gen(function* () { const fs = yield* FileSystem.FileSystem; yield* Console.log(yield* fs.exists("/")); }));`);
  expect(ran).toEqual({ exitCode: 0, stdout: "true\n", stderr: "" });
});

test("a failing script reports its cause on stderr and exits 1, rather than writing the failure into stdout", async () => {
  const ran = await script(`main(Effect.fail(new Error("no answer")));`);
  expect(ran.exitCode).toBe(1);
  expect(ran.stdout).toBe("");
  expect(ran.stderr).toContain("no answer");
});
