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

export function launch(command: string, source: string): void {
  const root = Bun.fileURLToPath(new URL("../../", import.meta.url));
  const args = process.argv.slice(2);
  execInstalledBinary(command, root, args);
  if (process.platform !== "win32" && process.execve !== undefined) process.execve(process.execPath, [process.execPath, source, ...args]);
  const child = Bun.spawn([process.execPath, source, ...args], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  void child.exited.then((code) => { process.exitCode = code; });
}
