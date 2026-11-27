import { expect, test } from "bun:test";
import { Effect } from "effect";
import { NO_CALLER_OPTIONS } from "../../../src/delivery/caller-options.ts";
import { ciJobsOf } from "../../../src/delivery/ci-jobs.ts";
import { ciWorkflow } from "../../../src/delivery/full-set/ci.ts";
import { workflowText } from "../../../src/delivery/full-set/steps.ts";

function rewriteCi(text: string): string {
  const document: unknown = Bun.YAML.parse(text);
  const ci = Effect.runSync(ciJobsOf("code", { path: ".github/workflows/ci.yml", document, text }, {
    publicRepository: false,
    docsBuild: false,
    hasE2e: true,
  }));
  return workflowText(ciWorkflow({ kind: "code", ci, options: NO_CALLER_OPTIONS }, false));
}

test("checks-workflows preserves a self-hosted test job's runner label list instead of refusing it", () => {
  const source = `jobs:
  e2e:
    runs-on: [self-hosted, macOS, ARM64]
    steps:
      - id: test
        run: bunx checks-test --pr --tier=e2e
`;
  const written = rewriteCi(source);
  expect(Bun.YAML.parse(written)).toMatchObject({ jobs: { e2e: { "runs-on": ["self-hosted", "macOS", "ARM64"] } } });
  expect(rewriteCi(written)).toBe(written);
});
