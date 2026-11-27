import { DOWNLOADED_DIRECTORY, SHARD_DIRECTORY, STATE_PREFIX } from "../ci/mutation/report.ts";
import { BY_HAND } from "./ci.ts";
import { checkout, DOWNLOAD, expression, HOSTED, SETUP, TOKEN, UPLOAD, workflowText, type Step, type Workflow } from "./steps.ts";

const SHARDS = 12;
const MAX_PARALLEL_SHARDS = 4;
const SHARD_JOB_MINUTES = 35;
const INCREMENTAL = "reports/stryker-incremental.json";

const prune: Step = { name: "prune superseded baselines", env: [TOKEN], run: "bunx checks-mutation-baseline --prune" };

const everyShardFinished = "steps.pass.outputs.finished == 'true'";
const someShardStopped = "steps.pass.outputs.finished == 'false'";

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
        {
          name: "restore the last full report and the state a stopped run left",
          env: [TOKEN],
          run: 'bunx checks-mutation-baseline --full "$RUNNER_TEMP/last-full/mutation.json" "$RUNNER_TEMP/last-full/stryker-incremental.json"',
        },
        { id: "shards", name: "split the tree into shards", env: [["SHARDS", JSON.stringify(String(SHARDS))]], run: "bunx checks-ci mutation shards" },
      ],
    },
    {
      id: "refresh-shard",
      needs: "refresh-plan",
      matrix: ["shard", expression("fromJSON(needs.refresh-plan.outputs.shards)")],
      maxParallel: MAX_PARALLEL_SHARDS,
      runsOn: HOSTED,
      timeout: SHARD_JOB_MINUTES,
      permissions: ["contents: read", "actions: read"],
      steps: [
        checkout({}),
        SETUP,
        {
          name: "restore the state the last run left",
          env: [TOKEN],
          run: `bunx checks-mutation-baseline --full "$RUNNER_TEMP/last-full/mutation.json" ${INCREMENTAL}`,
        },
        {
          name: "run one shard",
          env: [
            ["SHARD", expression("matrix.shard")],
            ["INDEX", expression("strategy.job-index")],
            ["CHECKS_MUTATION_MODE", "refresh"],
          ],
          run: "bunx checks-ci mutation shard",
        },
        {
          note: "A lone shard's artifact downloads with no folder of its own, so only the file's name tells the states apart.",
          uses: UPLOAD,
          with: [
            ["name", "mutation-shard-" + expression("strategy.job-index")],
            ["path", SHARD_DIRECTORY + "/"],
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
        { uses: DOWNLOAD, with: [["pattern", "mutation-shard-*"], ["path", DOWNLOADED_DIRECTORY], ["merge-multiple", "true"]] },
        { id: "pass", name: "find out whether every shard finished", run: "bunx checks-ci mutation finished" },
        { name: "merge the shard states", run: `bunx checks-mutation-merge reports/mutation/mutation.json ${DOWNLOADED_DIRECTORY}/${STATE_PREFIX}*.json` },
        { if: expression("always() && " + everyShardFinished), name: "score the refresh", run: "bunx checks-ci mutation score" },
        { if: expression(everyShardFinished), name: "slim the merged report", run: 'bunx checks-mutation-baseline --slim reports/mutation/mutation.json "$RUNNER_TEMP/full/mutation.json"' },
        { if: expression(everyShardFinished), name: "save the merged report as the state a baseline starts from", run: 'cp "$RUNNER_TEMP/full/mutation.json" "$RUNNER_TEMP/full/stryker-incremental.json"' },
        {
          if: expression(everyShardFinished),
          uses: UPLOAD,
          with: [
            ["name", "mutation-baseline-full"],
            ["path", expression("runner.temp") + "/full/"],
            ["retention-days", "30"],
            ["if-no-files-found", "error"],
          ],
        },
        {
          if: expression(someShardStopped),
          name: "slim the merged state a later run resumes from",
          run: 'bunx checks-mutation-baseline --slim reports/mutation/mutation.json "$RUNNER_TEMP/refresh/stryker-incremental.json"',
        },
        {
          if: expression(someShardStopped),
          uses: UPLOAD,
          with: [
            ["name", "mutation-refresh-state"],
            ["path", expression("runner.temp") + "/refresh/"],
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
