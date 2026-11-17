import { afterEach, beforeEach } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const CI_MAIN = join(import.meta.dir, "../../../src/delivery/ci/main.ts");

type Recorded = { readonly method: string; readonly path: string; readonly authorization: string; readonly body: unknown };

type Answer = { readonly status: number; readonly body: unknown };

export type Route = (method: string, path: string, body: unknown) => Answer | undefined;

export type StubApi = { readonly base: string; readonly requests: Recorded[]; readonly stop: () => Promise<void> };

const NOT_FOUND: Answer = { status: 404, body: { success: false, errors: [{ message: "no such route in the stub" }] } };

export function startStubApi(route: Route): StubApi {
  const requests: Recorded[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url);
      const path = `${url.pathname}${url.search}`;
      const text = await request.text();
      const body: unknown = text === "" ? undefined : JSON.parse(text);
      requests.push({ method: request.method, path, authorization: request.headers.get("authorization") ?? "", body });
      const answer = route(request.method, path, body) ?? NOT_FOUND;
      return answer.status === 204 ? new Response(null, { status: 204 }) : Response.json(answer.body, { status: answer.status });
    },
  });
  return { base: `http://127.0.0.1:${server.port}`, requests, stop: () => server.stop(true) };
}

export function apiEnv(stub: StubApi, outputFile: string): Record<string, string> {
  return {
    PATH: process.env["PATH"] ?? "",
    CLOUDFLARE_API_BASE: `${stub.base}/cf`,
    GITHUB_API_URL: `${stub.base}/gh`,
    GITHUB_REPOSITORY: "owner/site",
    GITHUB_OUTPUT: outputFile,
    CLOUDFLARE_API_TOKEN: "cf-token-value",
    CLOUDFLARE_ACCOUNT_ID: "acct",
    GH_TOKEN: "gh-token-value",
  };
}

export type Ran = { readonly exitCode: number; readonly stdout: string; readonly stderr: string };

export async function runCi(command: string, args: readonly string[], env: Readonly<Record<string, string>>, cwd = process.cwd()): Promise<Ran> {
  const child = Bun.spawn([process.execPath, CI_MAIN, command, ...args], { env, cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { exitCode, stdout, stderr };
}

export function stubBin(dir: string, name: string, then: string): void {
  mkdirSync(dir, { recursive: true });
  const record = `${process.execPath} -e 'console.log(JSON.stringify(process.argv.slice(1)))' -- "$@" >> "$STUB_RECORD"`;
  writeFileSync(join(dir, name), `#!/bin/sh\n${record}\n${then}\n`);
  chmodSync(join(dir, name), 0o755);
}

export function recordedCalls(file: string): unknown[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").trim().split("\n").map((line): unknown => JSON.parse(line));
}

export type Scratch = {
  readonly at: (...parts: readonly string[]) => string;
  readonly read: (name: string) => string;
  readonly write: (name: string, text: string) => void;
};

export function useScratch(prefix: string): Scratch {
  let root = "";
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), `${prefix}-`));
    writeFileSync(join(root, "output"), "");
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const at = (...parts: readonly string[]) => join(root, ...parts);
  return {
    at,
    read: (name) => (existsSync(at(name)) ? readFileSync(at(name), "utf8") : ""),
    write: (name, text) => {
      writeFileSync(at(name), text);
    },
  };
}
