import { defineConfig } from "@avi2dg/checks/config";

export default defineConfig({
  workflows: { releaseAssets: true },
  copy: { inputs: ["README.md", "CONTRIBUTING.md", "docs/design.md", "docs/configs/*.md", "docs/gates/*.md"] },
});
