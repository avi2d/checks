import { Effect, FileSystem, Path } from "effect";
import manifest from "../package.json";
import { runMain, Usage } from "../src/core/main.ts";
import { assetName, nativePlatforms, platformBinary, platformPackage, type NativePlatform } from "../src/core/native-platforms.ts";
import { publishExactPackage } from "../src/delivery/release-publish.ts";

const npmManifest = (value: object): string => JSON.stringify(value, null, 2) + "\n";
const packageDir = (directory: string, platform: NativePlatform) =>
  Path.Path.use((path) => Effect.succeed(path.resolve(directory, "npm", platformPackage(platform))));

const writePlatform = Effect.fn("writePlatform")(function* (directory: string, platform: NativePlatform) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const destination = yield* packageDir(directory, platform);
  const binary = path.join(destination, platformBinary);
  yield* fs.makeDirectory(destination, { recursive: true });
  yield* fs.copyFile(path.join(directory, assetName(platform)), binary);
  yield* fs.chmod(binary, 0o755);
  yield* fs.writeFileString(path.join(destination, "package.json"), npmManifest({
    name: platformPackage(platform),
    version: manifest.version,
    os: [platform.os],
    cpu: [platform.cpu],
    files: [platformBinary],
    license: manifest.license,
    repository: manifest.repository,
    publishConfig: manifest.publishConfig,
  }));
});

const packageRelease = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const [mode, destination, ...extra] = process.argv.slice(2);
  if (mode === undefined || destination === undefined || extra.length > 0) {
    return yield* new Usage({ message: "usage: package-release.ts {stage <assets-directory>|publish <assets-directory>|manifest <package.json>}" });
  }
  switch (mode) {
    case "stage":
      for (const platform of nativePlatforms) yield* writePlatform(destination, platform);
      break;
    case "publish":
      for (const platform of nativePlatforms) yield* publishExactPackage(yield* packageDir(destination, platform));
      break;
    case "manifest": {
      const optionalDependencies = Object.fromEntries(nativePlatforms.map((platform) => [platformPackage(platform), manifest.version]));
      yield* fs.writeFileString(path.resolve(destination), npmManifest({ ...manifest, optionalDependencies }));
      break;
    }
    default:
      return yield* new Usage({ message: `unknown mode: ${mode}` });
  }
  return true;
});

if (import.meta.main) runMain("package-release", packageRelease);
