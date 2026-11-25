import { Effect, FileSystem, Path } from "effect";
import { runMain } from "../src/core/main.ts";
import { commands } from "./cli-sources.ts";

const writeLaunchers = Effect.gen(function* () {
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  for (const { launcher, source, name } of commands) {
    const directory = path.dirname(launcher);
    const relative = (file: string) => path.relative(directory, file).split(path.sep).join("/");
    const text = [
      "#!/usr/bin/env bun",
      `import { launch } from "${relative("src/core/native-launch.ts")}";`,
      `const source = Bun.fileURLToPath(import.meta.resolve("${relative(source)}"));`,
      `launch("${name}", source);`,
      "",
    ].join("\n");
    yield* fs.makeDirectory(directory, { recursive: true });
    yield* fs.writeFileString(launcher, text, { mode: 0o755 });
  }
  return true;
});

if (import.meta.main) runMain("launchers-write", writeLaunchers);
