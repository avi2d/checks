import manifest from "../../package.json";

export function launch(command: string, source: string): void {
  const root = Bun.fileURLToPath(new URL("../../", import.meta.url));
  const native = root + `native/checks-${manifest.version}-${process.platform}-${process.arch}`;
  const supported = (process.platform === "darwin" && process.arch === "arm64") || (process.platform === "linux" && process.arch === "x64");
  const args = process.argv.slice(2);
  if (supported && Bun.which(native) !== null && process.execve !== undefined) {
    process.execve(native, [native, command, root, process.execPath, ...args]);
  }
  if (process.platform !== "win32" && process.execve !== undefined) process.execve(process.execPath, [process.execPath, source, ...args]);
  const child = Bun.spawn([process.execPath, source, ...args], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  void child.exited.then((code) => { process.exitCode = code; });
}
