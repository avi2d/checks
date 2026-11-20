const MUTATE = ["src/**/*.{ts,tsx}", "!src/**/*.test.{ts,tsx}"];

const flow = (values: readonly string[]): string => "[" + values.map((value) => JSON.stringify(value)).join(", ") + "]";

export const STRYKER_CONFIG = [
  "import preset from \"@avi2dg/checks/stryker.preset.js\";",
  "",
  "export default { ...preset, mutate: " + flow(MUTATE) + " };",
  "",
].join("\n");

export const KNIP_CONFIG = [
  "import { defineConfig } from \"@avi2dg/checks/knip\";",
  "",
  "export default defineConfig({ entry: [\"src/index.ts\"] });",
  "",
].join("\n");

export const JSCPD_CONFIG = [
  "{",
  "  \"path\": [\"src\"],",
  "  \"format\": [\"typescript\"],",
  "  \"ignore\": [\"**/*.d.ts\"]",
  "}",
  "",
].join("\n");
