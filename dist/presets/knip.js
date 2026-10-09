// src/quality/presets/knip.ts
var DEFAULT_ENTRY = ["tests/**/*.test.ts", "dependency-cruiser.config.ts"];
var REFUSED_ENTRY = "@avi2dg/checks/knip: set entry to the files nothing imports, or [] when package.json scripts and tests name them all";
function isGlobList(value) {
  return Array.isArray(value) && value.every((glob) => typeof glob === "string" && glob !== "");
}
function defineConfig({ entry, ...rest }) {
  if (!isGlobList(entry))
    throw new TypeError(REFUSED_ENTRY);
  return { include: ["files"], ...rest, entry: [...new Set([...entry, ...DEFAULT_ENTRY])] };
}
export {
  DEFAULT_ENTRY,
  defineConfig
};
