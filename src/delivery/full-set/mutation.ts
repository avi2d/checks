import { BY_HAND } from "./ci.ts";
import { checkout, DOWNLOAD, expression, HOSTED, SETUP, TOKEN, UPLOAD, workflowText, type Step, type Workflow } from "./steps.ts";

const SHARDS = 4;

const prune: Step = { name: "prune superseded baselines", env: [TOKEN], run: "bunx checks-mutation-baseline --prune" };

// A whole-tree run calls the refresh as a local reusable workflow, since a job of its own that runs mutation is refused.
const MUTATION: Workflow = {
  name: "mutation",
  on: [...BY_HAND, "workflow_call:"],
  concurrency: "mutation-refresh",
  cancelInProgress: false,
  env: [["RUNNER_ENVIRONMENT", "github-hosted"]],
  jobs: [
    {
      id: "refresh-plan",
      runsOn: HOSTED,
      timeout: 15,
      permissions: ["contents: read", "actions: read"],
      outputs: [["shards", expression("steps.shards.outputs.shards")]],
      steps: [
        checkout({}),
        SETUP,
        { name: "restore the last full report", env: [TOKEN], run: 'bunx checks-mutation-baseline --full "$RUNNER_TEMP/last-full/mutation.json"' },
        { id: "shards", name: "split the tree into shards", env: [["SHARDS", JSON.stringify(String(SHARDS))]], run: "bunx checks-ci mutation shards" },
      ],
    },
    {
      id: "refresh-shard",
      needs: "refresh-plan",
      matrix: ["shard", expression("fromJSON(needs.refresh-plan.outputs.shards)")],
      runsOn: HOSTED,
      timeout: 60,
      permissions: ["contents: read"],
      steps: [
        checkout({}),
        SETUP,
        { name: "run one shard", env: [["SHARD", expression("matrix.shard")]], run: 'bunx stryker run --mutate "$SHARD"' },
        {
          note: "A lone shard's artifact downloads with no folder of its own, so only the file's name tells the reports apart.",
          name: "name the report after its shard",
          env: [["INDEX", expression("strategy.job-index")]],
          run: 'mv reports/mutation/mutation.json "reports/mutation/shard-$INDEX.json"',
        },
        {
          uses: UPLOAD,
          with: [
            ["name", "mutation-shard-" + expression("strategy.job-index")],
            ["path", "reports/mutation/shard-" + expression("strategy.job-index") + ".json"],
            ["retention-days", "1"],
            ["if-no-files-found", "error"],
          ],
        },
      ],
    },
    {
      id: "refresh-merge",
      needs: "[refresh-plan, refresh-shard]",
      runsOn: HOSTED,
      timeout: 15,
      permissions: ["contents: read", "actions: write"],
      steps: [
        checkout({}),
        SETUP,
        { uses: DOWNLOAD, with: [["pattern", "mutation-shard-*"], ["path", "shards"], ["merge-multiple", "true"]] },
        { name: "merge the shard reports", run: "bunx checks-mutation-merge reports/mutation/mutation.json shards/shard-*.json" },
        { if: "always()", name: "score the refresh", run: "bunx checks-ci mutation score" },
        { name: "slim the merged report", run: 'bunx checks-mutation-baseline --slim reports/mutation/mutation.json "$RUNNER_TEMP/full/mutation.json"' },
        { name: "save the merged report as the state a baseline starts from", run: 'cp "$RUNNER_TEMP/full/mutation.json" "$RUNNER_TEMP/full/stryker-incremental.json"' },
        {
          uses: UPLOAD,
          with: [
            ["name", "mutation-baseline-full"],
            ["path", expression("runner.temp") + "/full/"],
            ["retention-days", "30"],
            ["if-no-files-found", "error"],
          ],
        },
        prune,
      ],
    },
  ],
};

export const MUTATION_WORKFLOW = workflowText(MUTATION);
