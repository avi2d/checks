import preset, { unitTestFiles } from "./stryker.preset.js";

export default {
  ...preset,
  // Only unit tests run per mutant: the e2e tests spawn processes and take minutes each.
  bun: {
    ...preset.bun,
    testFiles: unitTestFiles(),
  },
};
