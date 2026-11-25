import manifest from "../package.json";

const BIN = "dist/bin/";

export const commands = Object.entries(manifest.bin).flatMap(([name, launcher]) => launcher.startsWith(BIN)
  ? [{ name, launcher, source: "src/" + launcher.slice(BIN.length) }]
  : []);
