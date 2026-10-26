import { expect, test } from "bun:test";
import { verdictOf } from "../../src/delivery/release-push.ts";

function run(workflow: string, status: string, conclusion: string | null, id: number) {
  return { path: `.github/workflows/${workflow}`, status, conclusion, html_url: `https://github.com/acme/widget/actions/runs/${id}` };
}

test("a check with no run yet or a run still going keeps the release waiting", () => {
  expect(verdictOf(["ci.yml"], [])).toEqual({ kind: "pending", waiting: ["ci.yml"] });
  expect(verdictOf(["ci.yml", "e2e.yml"], [run("ci.yml", "completed", "success", 1), run("e2e.yml", "in_progress", null, 2)])).toEqual({
    kind: "pending",
    waiting: ["e2e.yml"],
  });
  expect(verdictOf(["ci.yml"], [run("ci.yml", "queued", null, 1)])).toEqual({ kind: "pending", waiting: ["ci.yml"] });
});

test("every check concluding success passes, and a run of another workflow counts for none", () => {
  expect(verdictOf(["ci.yml"], [run("ci.yml", "completed", "success", 1)])).toEqual({ kind: "passed" });
  expect(verdictOf(["ci.yml"], [run("mutation.yml", "completed", "success", 1)])).toEqual({ kind: "pending", waiting: ["ci.yml"] });
  expect(verdictOf(["ci.yml"], [{ ...run("ci.yml", "completed", "success", 1), path: ".github/workflows/ci.yml@refs/heads/release/main" }])).toEqual({ kind: "passed" });
});

test("any completed check short of success fails at once, even while another still runs", () => {
  expect(verdictOf(["ci.yml", "e2e.yml"], [run("ci.yml", "completed", "cancelled", 3), run("e2e.yml", "in_progress", null, 4)])).toEqual({
    kind: "failed",
    failed: ["ci.yml concluded cancelled at https://github.com/acme/widget/actions/runs/3"],
  });
});

test("the newest run of a workflow decides, so a passing rerun stands in for the failure it repeats", () => {
  expect(verdictOf(["ci.yml"], [run("ci.yml", "completed", "success", 2), run("ci.yml", "completed", "failure", 1)])).toEqual({ kind: "passed" });
  expect(verdictOf(["ci.yml"], [run("ci.yml", "completed", "failure", 2), run("ci.yml", "completed", "success", 1)])).toEqual({
    kind: "failed",
    failed: ["ci.yml concluded failure at https://github.com/acme/widget/actions/runs/2"],
  });
});
