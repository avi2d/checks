import type { TestOptions } from "../core/test-script.ts";
import type { Environment } from "./test-skips.ts";

export const APPROVE_VARIABLE = "APPROVE_SCREENS";

function refusal(run: string, workflow: string): string {
  return `refusing a \`${run}\` run outside CI; start the same run in CI with \`gh workflow run ${workflow}\``;
}

export function heavyRunRefusal(options: TestOptions, environment: Environment, approvingScreens: boolean): string | undefined {
  if (environment === "ci") return undefined;
  if (options.full === true) return refusal("--full", "ci");
  if (options.tier === "e2e") return refusal("--tier=e2e", "ci");
  if (options.tier === "pixel" && !approvingScreens) {
    return `${refusal("--tier=pixel", "whole-tree-run")}, or approve pictures here with \`${APPROVE_VARIABLE}=1\``;
  }
  return undefined;
}
