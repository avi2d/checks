import { SHARED_MUTATION } from "./mutation-workflow.ts";

const MUTATE = ["src/**/*.{ts,tsx}", "!src/**/*.test.{ts,tsx}"];

const flow = (values: readonly string[]): string => "[" + values.map((value) => JSON.stringify(value)).join(", ") + "]";

// The shared workflow picks the run from the event, so the caller names it and nothing else.
export const MUTATION_WORKFLOW = [
  "name: mutation",
  "",
  "on:",
  "  workflow_dispatch:",
  "",
  "jobs:",
  "  mutation:",
  "    uses: " + SHARED_MUTATION,
  "    permissions: { contents: read, actions: write, pull-requests: write }",
  "",
].join("\n");

export const STRYKER_CONFIG = [
  "import preset from \"@avi2dg/checks/stryker.preset.js\";",
  "",
  "export default { ...preset, mutate: " + flow(MUTATE) + " };",
  "",
].join("\n");
