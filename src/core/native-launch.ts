import { Effect } from "effect";
import { nativePlatform, platformBinary, platformPackage } from "./native-platforms.ts";

function installedBinary(): string | null {
  if (nativePlatform === undefined) return null;
  const specifier = `${platformPackage(nativePlatform)}/${platformBinary}`;
  return Effect.try(() => Bun.fileURLToPath(import.meta.resolve(specifier))).pipe(
    Effect.map((file) => Bun.which(file)),
    Effect.orElseSucceed(() => null),
    Effect.runSync,
  );
}

export function launch(command: string, source: string): void {
  const root = Bun.fileURLToPath(new URL("../../", import.meta.url));
  const native = installedBinary();
  const args = process.argv.slice(2);
  if (native !== null && process.execve !== undefined) {
    process.execve(native, [native, command, root, process.execPath, ...args]);
  }
  if (process.platform !== "win32" && process.execve !== undefined) process.execve(process.execPath, [process.execPath, source, ...args]);
  const child = Bun.spawn([process.execPath, source, ...args], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  void child.exited.then((code) => { process.exitCode = code; });
}
