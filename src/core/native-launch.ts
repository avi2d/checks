import { readFileSync } from "node:fs";
import { nativePlatform, platformBinary, platformPackage } from "./native-platforms.ts";

function execInstalledBinary(command: string, root: string, args: readonly string[]): void {
  if (nativePlatform === undefined || process.execve === undefined) return;
  const specifier = `${platformPackage(nativePlatform)}/${platformBinary}`;
  try {
    const native = Bun.which(Bun.fileURLToPath(import.meta.resolve(specifier)));
    if (native !== null) process.execve(native, [native, command, root, process.execPath, ...args]);
  } catch {
    // A missing package or a binary the host cannot load, such as a glibc build on musl, leaves the source to run.
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readObject(file: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!isObject(value)) throw new Error(`Invalid manifest: ${file}`);
  return value;
}

function compatibleEffect(root: string): boolean {
  const manifest = readObject(`${root}/package.json`);
  const peers = manifest["peerDependencies"];
  if (typeof peers !== "object" || peers === null || !("effect" in peers) || typeof peers.effect !== "string") {
    throw new Error("Missing Effect peer version in checks manifest");
  }
  const required = peers.effect;
  let found = "not installed";
  try {
    const effectManifest = readObject(Bun.resolveSync("effect/package.json", import.meta.path));
    found = typeof effectManifest["version"] === "string" ? effectManifest["version"] : "unknown";
  } catch {
    found = "not installed or unreadable";
  }
  if (found === required) return true;
  console.error(`checks: requires effect ${required}, found ${found}`);
  return false;
}

export function launch(command: string, source: string): void {
  const root = Bun.fileURLToPath(new URL("../../", import.meta.url));
  if (!compatibleEffect(root)) {
    process.exitCode = 1;
    return;
  }
  const args = process.argv.slice(2);
  execInstalledBinary(command, root, args);
  if (process.platform !== "win32" && process.execve !== undefined) process.execve(process.execPath, [process.execPath, source, ...args]);
  const child = Bun.spawn([process.execPath, source, ...args], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  void child.exited.then((code) => { process.exitCode = code; });
}
