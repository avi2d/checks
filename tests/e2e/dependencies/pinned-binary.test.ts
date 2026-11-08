import { $ } from "bun";
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BunServices } from "@effect/platform-bun";
import { Effect } from "effect";
import { installPinned, type Retry } from "../../../src/dependencies/pinned-binary.ts";
import { scratchDirs } from "../lib/fixture-repo.ts";

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

const FAST: Retry = { attempts: 4, firstDelay: "40 millis" };

function flaky(failures: number, status: number) {
  const requests: number[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: () => {
      requests.push(performance.now());
      return requests.length <= failures ? new Response("gateway timeout", { status }) : new Response(BYTES);
    },
  });
  return { url: `http://localhost:${server.port}/osv-scanner`, requests, stop: () => server.stop(true) };
}

// Bun.serve answers every request with a status, so only a raw socket closes one unanswered.
function droppingFirst(drops: number) {
  let connections = 0;
  const server = Bun.listen({
    hostname: "localhost",
    port: 0,
    socket: {
      data: (socket) => {
        connections += 1;
        if (connections > drops) {
          socket.write(`HTTP/1.1 200 OK\r\nContent-Length: ${BYTES.length}\r\nConnection: close\r\n\r\n`);
          socket.write(BYTES);
        }
        socket.end();
      },
    },
  });
  return { url: `http://localhost:${server.port}/osv-scanner`, connections: () => connections, stop: () => server.stop(true) };
}

const install = (url: string, sha256: string, binary: string, retry: Retry = FAST) =>
  installPinned({ kind: "binary", url, sha256 }, binary, retry).pipe(Effect.provide(BunServices.layer));
const failureOf = async (url: string, sha256: string, binary: string) => (await Effect.runPromise(Effect.flip(install(url, sha256, binary)))).message;
const listed = (dir: string) => readdir(dir).catch(() => []);

test("the pinned download installs only bytes whose SHA-256 matches, then reuses the verified copy and refuses a tampered one", async () => {
  const dir = join(await scratch("checks-osv-install-"), "2.6.0");
  const binary = join(dir, "osv-scanner");
  const server = release();
  try {
    expect(await failureOf(`${server.url}-gone`, SHA256, binary)).toContain("cannot download");
    expect(server.downloads()).toBe(0);
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

test("a download that answers 504 three times retries with a growing wait and installs on the fourth answer rather than failing on the first 504", async () => {
  const binary = join(await scratch("checks-pinned-retry-"), "osv-scanner");
  const server = flaky(3, 504);
  try {
    expect(await Effect.runPromise(install(server.url, SHA256, binary))).toBe(binary);
    expect(new Uint8Array(await readFile(binary))).toEqual(BYTES);
    expect(server.requests.length).toBe(4);
    const waits = server.requests.slice(1).map((at, index) => at - (server.requests[index] ?? at));
    expect(waits[0]).toBeGreaterThanOrEqual(40);
    expect(waits[1]).toBeGreaterThanOrEqual(80);
    expect(waits[2]).toBeGreaterThanOrEqual(160);
  } finally {
    await server.stop();
  }
});

test("a download that answers 504 on every attempt stops after the last attempt and refuses naming 504 rather than passing or retrying forever", async () => {
  const dir = await scratch("checks-pinned-exhausted-");
  const binary = join(dir, "osv-scanner");
  const server = flaky(Number.POSITIVE_INFINITY, 504);
  try {
    const message = await failureOf(server.url, SHA256, binary);
    expect(message).toContain(`cannot download ${server.url} in 4 attempt(s)`);
    expect(message).toContain(`504 GET ${server.url}`);
    expect(server.requests.length).toBe(4);
    expect(await listed(dir)).toEqual([]);
  } finally {
    await server.stop();
  }
});

test("a download whose connection drops before any answer retries it rather than failing on the network error", async () => {
  const binary = join(await scratch("checks-pinned-dropped-"), "osv-scanner");
  const server = droppingFirst(2);
  try {
    expect(await Effect.runPromise(install(server.url, SHA256, binary))).toBe(binary);
    expect(new Uint8Array(await readFile(binary))).toEqual(BYTES);
    expect(server.connections()).toBe(3);
  } finally {
    server.stop();
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
