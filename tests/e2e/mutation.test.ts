import { $ } from "bun";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { CHECKOUT, fixtureRepos, ran } from "./lib/fixture-repo.ts";

const open = fixtureRepos("checks-mutation-");
const SCRIPT = join(CHECKOUT, "src", "testing", "mutation.ts");

test("a full run outside CI is refused and names the workflow command", async () => {
  const repo = await open({});
  const { CI: _ci, ...withoutCi } = process.env;
  const refused = await ran(
    $`bun ${SCRIPT}`.cwd(repo.dir).env({
      ...withoutCi,
      PATH: `${join(CHECKOUT, "node_modules/.bin")}:${withoutCi["PATH"] ?? ""}`,
    }),
  );
  expect(refused.exitCode).toBe(2);
  expect(refused.text).toContain("gh workflow run mutation");
}, 60_000);
