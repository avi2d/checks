import { expect, test } from "bun:test";
import { branchAlias } from "../../../../src/delivery/ci/preview-address.ts";

test.each([
  ["Feature/Add_Login", "feature-add-login"],
  ["dependabot/github_actions/actions/checkout-5.1.0", "dependabot-github-actions-ac"],
  ["fm/workflows-site-shared-pieces", "fm-workflows-site-shared-pie"],
  ["--Fix--", "fix"],
  ["a/bcdefghijklmnopqrstuvwxyz-/tail", "a-bcdefghijklmnopqrstuvwxyz"],
  ["ÄBC", "bc"],
])("the branch %p aliased other than %p, as the lowercase, dash and cut-to-28 pipeline names it, fails", (branch, alias) => {
  expect(branchAlias(branch)).toBe(alias);
});
