import { $ } from "bun";
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BunServices } from "@effect/platform-bun";
import { Effect } from "effect";
import { installPinned } from "../../src/dependencies/pinned-binary.ts";
import { scratchDirs } from "./lib/fixture-repo.ts";

const scratch = scratchDirs();
const BYTES = new TextEncoder().encode("#!/bin/sh\necho fake osv-scanner\n");
const sha256Of = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const SHA256 = sha256Of(BYTES);

function release(name = "osv-scanner", bytes: Uint8Array = BYTES) {
  let downloads = 0;
  const server = Bun.serve({
    port: 0,
    fetch: (request) => {
      if (!request.url.endsWith(`/${name}`)) return new Response("missing", { status: 404 });
      downloads += 1;
      return new Response(bytes);
    },
  });
  return { url: `http://localhost:${server.port}/${name}`, downloads: () => downloads, stop: () => server.stop(true) };
}

const install = (url: string, sha256: string, binary: string) => installPinned({ kind: "binary", url, sha256 }, binary).pipe(Effect.provide(BunServices.layer));
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

test("a pinned archive installs only the member whose SHA-256 matches, and the installed copy is checked against the member's", async () => {
  const packed = await scratch("checks-pinned-archive-");
  await mkdir(join(packed, "contents"));
  await writeFile(join(packed, "contents", "gitleaks"), BYTES);
  await writeFile(join(packed, "contents", "README.md"), "readme");
  await $`tar -czf ${join(packed, "gitleaks.tar.gz")} -C ${join(packed, "contents")} gitleaks README.md`.quiet();
  const archive = new Uint8Array(await readFile(join(packed, "gitleaks.tar.gz")));
  const dir = join(await scratch("checks-gitleaks-install-"), "8.30.1");
  const binary = join(dir, "gitleaks");
  const server = release("gitleaks.tar.gz", archive);
  const asset = (memberSha256: string) => ({ kind: "tar.gz", url: server.url, sha256: sha256Of(archive), member: "gitleaks", memberSha256 }) as const;
  const run = (memberSha256: string) => installPinned(asset(memberSha256), binary).pipe(Effect.provide(BunServices.layer));
  try {
    const wrongMember = (await Effect.runPromise(Effect.flip(run("0".repeat(64))))).message;
    expect(wrongMember).toContain(`gitleaks in ${server.url} has SHA-256 ${SHA256}, not the pinned ${"0".repeat(64)}, so nothing was installed`);
    expect(await listed(dir)).toEqual([]);

    expect(await Effect.runPromise(run(SHA256))).toBe(binary);
    expect(new Uint8Array(await readFile(binary))).toEqual(BYTES);
    expect((await stat(binary)).mode & 0o777).toBe(0o755);
    expect(await listed(dir)).toEqual(["gitleaks"]);

    await Effect.runPromise(run(SHA256));
    expect(server.downloads()).toBe(2);
  } finally {
    await server.stop();
  }
});
