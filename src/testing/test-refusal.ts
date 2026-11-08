import type { TestOptions } from "../core/test-script.ts";
import type { Environment } from "./test-skips.ts";

export const APPROVE_VARIABLE = "APPROVE_SCREENS";

function refusal(run: string, workflow: string): string {
  return `refusing a \`${run}\` run outside CI; push the branch, then start the same run in CI with \`gh workflow run ${workflow} --ref <branch>\``;
}

function pullRequestRefusal(run: string): string {
  return `refusing a \`${run}\` run outside CI; push the branch and open or update its pull request so CI runs the checks, and the full suite runs at release`;
}

export function heavyRunRefusal(options: TestOptions, environment: Environment, approvingScreens: boolean): string | undefined {
  if (environment === "ci") return undefined;
  if (options.full === true) return pullRequestRefusal("--full");
  if (options.tier === "e2e") return pullRequestRefusal("--tier=e2e");
  if (options.tier === "pixel" && !approvingScreens) {
    return `${refusal("--tier=pixel", "whole-tree-run")}, or approve pictures here with \`${APPROVE_VARIABLE}=1\``;
  }
  return undefined;
}
