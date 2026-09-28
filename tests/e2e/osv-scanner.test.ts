import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BunServices } from "@effect/platform-bun";
import { Effect } from "effect";
import { installPinned } from "../../src/dependencies/osv-scanner.ts";
import { scratchDirs } from "./lib/fixture-repo.ts";

const scratch = scratchDirs();
const BYTES = new TextEncoder().encode("#!/bin/sh\necho fake osv-scanner\n");
const SHA256 = createHash("sha256").update(BYTES).digest("hex");

function release() {
  let downloads = 0;
  const server = Bun.serve({
    port: 0,
    fetch: (request) => {
      if (!request.url.endsWith("/osv-scanner")) return new Response("missing", { status: 404 });
      downloads += 1;
      return new Response(BYTES);
    },
  });
  return { url: `http://localhost:${server.port}/osv-scanner`, downloads: () => downloads, stop: () => server.stop(true) };
}

const install = (url: string, sha256: string, binary: string) => installPinned(url, sha256, binary).pipe(Effect.provide(BunServices.layer));
const failureOf = async (url: string, sha256: string, binary: string) => (await Effect.runPromise(Effect.flip(install(url, sha256, binary)))).message;
const listed = (dir: string) => readdir(dir).catch(() => []);

test("the pinned download installs only bytes whose SHA-256 matches, then reuses the verified copy and refuses a tampered one", async () => {
  const dir = join(await scratch("checks-osv-install-"), "2.6.0");
  const binary = join(dir, "osv-scanner");
  const server = release();
  try {
    expect(await failureOf(`${server.url}-gone`, SHA256, binary)).toContain("cannot download");
    expect(await failureOf(server.url, "0".repeat(64), binary)).toContain(`has SHA-256 ${SHA256}, not the pinned ${"0".repeat(64)}, so nothing was installed`);
    expect(await listed(dir)).toEqual([]);

    expect(await Effect.runPromise(install(server.url, SHA256, binary))).toBe(binary);
    expect(new Uint8Array(await readFile(binary))).toEqual(BYTES);
    expect((await stat(binary)).mode & 0o777).toBe(0o755);
    expect(await listed(dir)).toEqual(["osv-scanner"]);

    await Effect.runPromise(install(server.url, SHA256, binary));
    expect(server.downloads()).toBe(2);

    await writeFile(binary, "tampered");
    expect(await failureOf(server.url, SHA256, binary)).toContain("delete it and rerun");
    expect(server.downloads()).toBe(2);
  } finally {
    await server.stop();
  }
});
