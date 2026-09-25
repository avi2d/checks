import { $ } from "bun";
import { expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fixtureRepos, type FixtureRepo } from "./lib/fixture-repo.ts";

const open = fixtureRepos("checks-quarantine-clock-");
const IDENTITY = ["-c", "user.name=Wren Fixture", "-c", "user.email=wren@example.com"];
const DAY = 86400 * 1000;

function daysAgo(days: number): string {
  return new Date(Date.now() - days * DAY).toISOString();
}

async function quarantine(repo: FixtureRepo, file: string, days: number): Promise<void> {
  await repo.write({ [file]: "import { expect, test } from \"bun:test\";\ntest(\"held\", () => {});\n" });
  await $`git add -A && git ${IDENTITY} commit -q --no-gpg-sign --date ${daysAgo(days)} -m ${`test: quarantine ${file}`}`
    .cwd(repo.dir)
    .quiet();
}

async function create(repo: FixtureRepo, file: string, days: number): Promise<void> {
  await repo.write({ [file]: "import { expect, test } from \"bun:test\";\ntest(\"held\", () => {});\n" });
  await $`git add -A && git ${IDENTITY} commit -q --no-gpg-sign --date ${daysAgo(days)} -m ${`test: add ${file}`}`
    .cwd(repo.dir)
    .quiet();
}

async function move(repo: FixtureRepo, from: string, to: string, days: number): Promise<void> {
  await mkdir(join(repo.dir, dirname(to)), { recursive: true });
  await $`git mv ${from} ${to}`.cwd(repo.dir).quiet();
  await $`git ${IDENTITY} commit -q --no-gpg-sign --date ${daysAgo(days)} -m ${`test: quarantine ${to}`}`
    .cwd(repo.dir)
    .quiet();
}

test(
  "a test quarantined more than 30 days before HEAD goes red naming it, its entry day and what to do",
  async () => {
    const repo = await open();
    await quarantine(repo, "tests/quarantine/billing.test.ts", 40);
    await repo.write({ "notes.md": "# notes\n" });
    const head = await repo.commit("chore: head");
    const entryDay = daysAgo(40).slice(0, "YYYY-MM-DD".length);

    const red = await repo.script("quarantine-clock.ts", head);
    expect(red.exitCode).toBe(1);
    expect(red.text).toContain(
      "quarantine-clock: 1 test(s) in tests/quarantine/ is past 30 days; fix each and move it back, or delete it:",
    );
    expect(red.text).toContain(`  tests/quarantine/billing.test.ts entered quarantine on ${entryDay} (`);

    const ranged = await repo.script("quarantine-clock.ts", `${head}~1`, head);
    expect(ranged.exitCode).toBe(1);
    expect(ranged.text).toContain("tests/quarantine/billing.test.ts entered quarantine on");
  },
  120_000,
);

test(
  "a test quarantined less than 30 days before HEAD goes green, even when the test itself is older",
  async () => {
    const repo = await open();
    await quarantine(repo, "tests/quarantine/fresh.test.ts", 5);
    await create(repo, "tests/ledger.test.ts", 40);
    await move(repo, "tests/ledger.test.ts", "tests/quarantine/ledger.test.ts", 5);
    await repo.write({ "notes.md": "# notes\n" });
    const head = await repo.commit("chore: head");

    const green = await repo.script("quarantine-clock.ts", head);
    expect(green.exitCode).toBe(0);
    expect(green.text).toContain("quarantine-clock: no test in tests/quarantine/ is past 30 days (2 checked)");
  },
  120_000,
);

test(
  "a move into quarantine starts the clock at the move, so an old move still goes red on its move day",
  async () => {
    const repo = await open();
    await create(repo, "tests/billing.test.ts", 50);
    await move(repo, "tests/billing.test.ts", "tests/quarantine/billing.test.ts", 40);
    await repo.write({ "notes.md": "# notes\n" });
    const head = await repo.commit("chore: head");
    const moveDay = daysAgo(40).slice(0, "YYYY-MM-DD".length);

    const red = await repo.script("quarantine-clock.ts", head);
    expect(red.exitCode).toBe(1);
    expect(red.text).toContain(`  tests/quarantine/billing.test.ts entered quarantine on ${moveDay} (`);
  },
  120_000,
);

test(
  "no quarantined test passes, and an unresolvable ref exits 2 rather than passing",
  async () => {
    const repo = await open();
    await repo.write({ "notes.md": "# notes\n" });
    const head = await repo.commit("chore: head");

    const none = await repo.script("quarantine-clock.ts", head);
    expect(none.exitCode).toBe(0);
    expect(none.text).toContain("quarantine-clock: no test in tests/quarantine/ is past 30 days (0 checked)");

    const unknown = await repo.script("quarantine-clock.ts", "no-such-ref");
    expect(unknown.exitCode).toBe(2);
    expect(unknown.text).toContain("quarantine-clock: git rev-parse");

    const usage = await repo.script("quarantine-clock.ts");
    expect(usage.exitCode).toBe(2);
    expect(usage.text).toContain("usage: quarantine-clock.ts");
  },
  120_000,
);
