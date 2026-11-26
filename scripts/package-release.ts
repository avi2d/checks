import { Effect, FileSystem, Path } from "effect";
import manifest from "../package.json";
import { runMain, Usage } from "../src/core/main.ts";
import { nativePlatforms } from "../src/core/native-platforms.ts";
import { npmManifest, publishPlatformPackages, stagePlatformPackages, withOptionalDependencies, type PlatformRelease } from "../src/delivery/platform-packages.ts";

const kitRelease = (directory: string): PlatformRelease => ({ directory, binary: "checks", manifest, platforms: nativePlatforms });

const packageRelease = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const [mode, destination, ...extra] = process.argv.slice(2);
  if (mode === undefined || destination === undefined || extra.length > 0) {
    return yield* new Usage({ message: "usage: package-release.ts {stage <assets-directory>|publish <assets-directory>|manifest <package.json>}" });
  }
  switch (mode) {
    case "stage":
      yield* stagePlatformPackages(kitRelease(destination));
      break;
    case "publish":
      yield* publishPlatformPackages(kitRelease(destination));
      break;
    case "manifest":
      yield* fs.writeFileString(path.resolve(destination), npmManifest(withOptionalDependencies(manifest, kitRelease(destination))));
      break;
    default:
      return yield* new Usage({ message: `unknown mode: ${mode}` });
  }
  return true;
});

if (import.meta.main) runMain("package-release", packageRelease);
