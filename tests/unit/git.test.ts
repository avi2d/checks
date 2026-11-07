import { BunServices } from "@effect/platform-bun";
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { existingFiles } from "../../src/core/git.ts";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

test("the files that exist come back in the order they were listed, rather than the order their checks finished", async () => {
  const dir = await mkdtemp(join(tmpdir(), "checks-existing-files-"));
  dirs.push(dir);
  const listed = Array.from({ length: 300 }, (_, index) => `file-${String(index).padStart(3, "0")}.ts`);
  const present = listed.filter((_, index) => index % 7 !== 3);
  for (const file of present) await writeFile(join(dir, file), "");

  const found = await Effect.runPromise(existingFiles(dir, listed).pipe(Effect.provide(BunServices.layer)));
  expect(found).toEqual(present);
});
