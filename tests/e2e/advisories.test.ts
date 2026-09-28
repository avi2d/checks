import { $ } from "bun";
import { expect, test } from "bun:test";
import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Option } from "effect";
import { buildFor, OSV_SCANNER_VERSION } from "../../src/dependencies/osv-scanner.ts";
import { withoutPullRequestEvent } from "../lib/env.ts";
import { FAKE_SCANNER_PATH, GATE_WITH_FAKE_SCANNER } from "./lib/advisories-gate.ts";
import { CHECKOUT, fixtureRepos, lintWiring, ran, scratchDirs, type FixtureRepo, type Ran } from "./lib/fixture-repo.ts";

const open = fixtureRepos("checks-advisories-");
const scratch = scratchDirs();
const IDENTITY = ["-c", "user.name=Wren Fixture", "-c", "user.email=wren@example.com"];
const DAY = 86_400_000;

const FAKE_SCANNER = `#!${process.execPath}
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_OSV_LOG, args.join(" ") + "\\n");
const lockfiles = args.flatMap((arg, index) => (arg === "-L" ? [args[index + 1]] : []));
if (lockfiles.every((path) => !/"[^"]+@[^"]+"/.test(readFileSync(path, "utf8")))) { console.error("No package sources found"); process.exit(128); }
const zip = join(process.env.OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY, "osv-scalibr", "npm", "all.zip");
if (args.includes("--download-offline-databases")) {
  if (process.env.FAKE_OSV_UNREACHABLE === "1") { console.error("unable to fetch OSV database: unreachable"); process.exit(127); }
  mkdirSync(dirname(zip), { recursive: true });
  writeFileSync(zip, "npm");
} else if (!existsSync(zip)) { console.error("no offline version of the OSV database is available"); process.exit(127); }
const KNOWN = [
  { name: "lodash", version: "4.17.20", vulnerabilities: [{ id: "GHSA-35jh-r3h4-6jhm", aliases: ["CVE-2021-23337"], summary: "Command Injection in lodash", database_specific: { severity: "HIGH" } }] },
  { name: "minimist", version: "0.0.8", vulnerabilities: [{ id: "GHSA-xvch-5gv4-984h", summary: "Prototype Pollution in minimist", database_specific: { severity: "CRITICAL" } }] },
];
const results = lockfiles.flatMap((path) => {
  const text = readFileSync(path, "utf8");
  const packages = KNOWN.filter(({ name, version }) => text.includes(\`"\${name}@\${version}"\`)).map(({ name, version, vulnerabilities }) => ({ package: { name, version, ecosystem: "npm" }, vulnerabilities }));
  return packages.length === 0 ? [] : [{ source: { path, type: "lockfile" }, packages }];
});
console.log(JSON.stringify({ results }));
process.exit(results.length === 0 ? 0 : 1);
`;

function lockfile(packages: Readonly<Record<string, string>>): string {
  const entries = Object.entries(packages).map(([name, version]) => `    "${name}": ["${name}@${version}", "", {}, "sha512-0"],`);
  return `{\n  "lockfileVersion": 1,\n  "workspaces": { "": { "name": "fixture" } },\n  "packages": {\n${entries.join("\n")}\n  }\n}\n`;
}

function day(ms: number): string {
  return new Date(ms).toISOString().slice(0, "YYYY-MM-DD".length);
}

type Sandbox = {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly calls: () => Promise<readonly string[]>;
  readonly summary: string;
  readonly marker: string;
  readonly scanner: string;
  readonly home: string;
};

async function sandbox(extra: Readonly<Record<string, string>> = {}): Promise<Sandbox> {
  const dir = await scratch("checks-advisories-home-");
  const scanner = join(dir, "osv-scanner");
  await writeFile(scanner, FAKE_SCANNER);
  await chmod(scanner, 0o755);
  const log = join(dir, "calls.log");
  await writeFile(log, "");
  const summary = join(dir, "summary.md");
  const env = { ...withoutPullRequestEvent(), HOME: dir, [FAKE_SCANNER_PATH]: scanner, FAKE_OSV_LOG: log, GITHUB_STEP_SUMMARY: summary, ...extra };
  const calls = async () => (await readFile(log, "utf8")).split("\n").filter((line) => line !== "");
  return { env, calls, summary, marker: join(dir, ".cache", "avi2dg-checks", "osv-scanner", "db", "refreshed"), scanner, home: dir };
}

function gate(repo: FixtureRepo, box: Sandbox, ...args: readonly string[]): Promise<Ran> {
  return ran($`${process.execPath} ${GATE_WITH_FAKE_SCANNER} ${args}`.cwd(repo.dir).env(box.env));
}

async function commitAt(repo: FixtureRepo, message: string, at: number): Promise<string> {
  const date = new Date(at).toISOString();
  await $`git add -A && git ${IDENTITY} commit -q --no-gpg-sign --date ${date} -m ${message}`
    .cwd(repo.dir)
    .env({ ...process.env, GIT_COMMITTER_DATE: date })
    .quiet();
  return (await $`git rev-parse HEAD`.cwd(repo.dir).quiet()).stdout.toString().trim();
}

test(
  "a range adding a vulnerable package fails naming it, and a range leaving bun.lock alone passes without a scan",
  async () => {
    const repo = await open({ "bun.lock": lockfile({ "left-pad": "1.3.0" }) });
    const base = await repo.commit("chore: lock");
    await repo.write({ "bun.lock": lockfile({ "left-pad": "1.3.0", lodash: "4.17.20" }) });
    const head = await repo.commit("build: add lodash");
    const box = await sandbox();

    const red = await gate(repo, box, base, head);
    expect(red.exitCode).toBe(1);
    expect(red.text).toContain("advisories: the range adds 1 advisory(ies) to bun.lock (0 at the head predate the range, 0 acknowledged)");
    expect(red.text).toContain("  lodash@4.17.20 GHSA-35jh-r3h4-6jhm high: Command Injection in lodash");
    const [scan = ""] = await box.calls();
    expect(scan).toContain("--download-offline-databases");
    expect(scan.match(/ -L /g)).toHaveLength(2);

    await repo.write({ "README.md": "# fixture\n" });
    const docs = await repo.commit("docs: readme");
    const skipped = await gate(repo, box, head, docs);
    expect(skipped.exitCode).toBe(0);
    expect(skipped.text).toContain("advisories: bun.lock is unchanged in the range, so nothing was scanned");
    expect(await box.calls()).toHaveLength(1);

    const tip = await gate(repo, box, head);
    expect(tip.exitCode).toBe(1);
    expect((await box.calls()).at(-1)).toContain("--offline");
  },
  120_000,
);

test(
  "an advisory already at the base fails no later range, and --all fails on it and writes the job summary",
  async () => {
    const repo = await open({ "bun.lock": lockfile({ lodash: "4.17.20" }) });
    const base = await repo.commit("chore: lock");
    await repo.write({ "bun.lock": lockfile({ lodash: "4.17.20", "left-pad": "1.3.0" }) });
    const head = await repo.commit("build: add left-pad");
    const box = await sandbox();

    const green = await gate(repo, box, base, head);
    expect(green.exitCode).toBe(0);
    expect(green.text).toContain("advisories: the range adds no advisory to bun.lock (1 at the head predate the range, 0 acknowledged)");

    const all = await gate(repo, box, "--all");
    expect(all.exitCode).toBe(1);
    expect(all.text).toContain("advisories: bun.lock at the head holds 1 unacknowledged advisory(ies)");
    expect(await readFile(box.summary, "utf8")).toContain("- lodash@4.17.20 GHSA-35jh-r3h4-6jhm high: Command Injection in lodash");
  },
  120_000,
);

test(
  "an acknowledgement clears an advisory until its day, counted from the head's date, and one past 30 days clears nothing",
  async () => {
    const now = Date.now();
    const repo = await open({ "bun.lock": lockfile({ "left-pad": "1.3.0" }) });
    const base = await repo.commit("chore: lock");
    const acknowledge = (until: string) =>
      JSON.stringify([{ package: "minimist", id: "GHSA-xvch-5gv4-984h", until, reason: "mkdirp never parses untrusted argv here" }]);
    await repo.write({ "bun.lock": lockfile({ "left-pad": "1.3.0", minimist: "0.0.8" }), "advisory-acks.json": acknowledge(day(now + 10 * DAY)) });
    const head = await commitAt(repo, "build: add minimist", now);
    const box = await sandbox();

    const acknowledged = await gate(repo, box, base, head);
    expect(acknowledged.exitCode).toBe(0);
    expect(acknowledged.text).toContain("(0 at the head predate the range, 1 acknowledged)");

    await repo.write({ "README.md": "# fixture\n" });
    const later = await commitAt(repo, "docs: readme", now + 20 * DAY);
    const expired = await gate(repo, box, head, later);
    expect(expired.exitCode).toBe(1);
    expect(expired.text).toContain(`  minimist GHSA-xvch-5gv4-984h expired on ${day(now + 10 * DAY)}; upgrade the package, or renew the entry with a new reason`);

    await repo.write({ "advisory-acks.json": acknowledge("2099-01-01") });
    const far = await commitAt(repo, "chore: acknowledge for longer", now);
    const refused = await gate(repo, box, base, far);
    expect(refused.exitCode).toBe(1);
    expect(refused.text).toContain("  minimist@0.0.8 GHSA-xvch-5gv4-984h critical: Prototype Pollution in minimist");
    expect(refused.text).toContain(`  minimist GHSA-xvch-5gv4-984h runs until 2099-01-01, more than 30 days out; name a day no later than ${day(now + 30 * DAY)}`);

    await repo.write({ "advisory-acks.json": JSON.stringify([{ package: "minimist", id: "GHSA-xvch-5gv4-984h", reason: "no day" }]) });
    const dayless = await commitAt(repo, "chore: acknowledge with no day", now);
    const undecided = await gate(repo, box, base, dayless);
    expect(undecided.exitCode).toBe(2);
    expect(undecided.text).toContain("advisory-acks.json at");
  },
  120_000,
);

test(
  "--all measures an acknowledgement from today, so it expires on a head that predates its day",
  async () => {
    const now = Date.now();
    const lapsed = day(now - 10 * DAY);
    const repo = await open({ "bun.lock": lockfile({ minimist: "0.0.8" }) });
    await repo.write({
      "advisory-acks.json": JSON.stringify([{ package: "minimist", id: "GHSA-xvch-5gv4-984h", until: lapsed, reason: "mkdirp never parses untrusted argv here" }]),
    });
    const head = await commitAt(repo, "chore: lock", now - 40 * DAY);
    const box = await sandbox();

    expect((await gate(repo, box, head)).exitCode).toBe(0);
    const all = await gate(repo, box, "--all");
    expect(all.exitCode).toBe(1);
    expect(all.text).toContain(`  minimist GHSA-xvch-5gv4-984h expired on ${lapsed}; upgrade the package, or renew the entry with a new reason`);
    expect(all.text).toContain("  minimist@0.0.8 GHSA-xvch-5gv4-984h critical: Prototype Pollution in minimist");
    expect((await gate(repo, box, "--all", head)).exitCode).toBe(2);
  },
  120_000,
);

test(
  "a failed refresh falls back to a database refreshed within 7 days, and exits 2 once none is",
  async () => {
    const repo = await open({ "bun.lock": lockfile({ lodash: "4.17.20" }) });
    const head = await repo.commit("chore: lock");
    const refreshed = await sandbox();
    expect((await gate(repo, refreshed, "--all")).exitCode).toBe(1);

    const unreachable = { ...refreshed, env: { ...refreshed.env, FAKE_OSV_UNREACHABLE: "1" } };
    await writeFile(refreshed.marker, `${new Date(Date.now() - 2 * DAY).toISOString()}\n`);
    const stale = await gate(repo, unreachable, head);
    expect(stale.exitCode).toBe(1);
    expect(stale.text).toContain("advisories: could not refresh the OSV database, so the scan read the copy refreshed 2 day(s) ago");

    await writeFile(refreshed.marker, `${new Date(Date.now() - 8 * DAY).toISOString()}\n`);
    const unusable = await gate(repo, unreachable, head);
    expect(unusable.exitCode).toBe(2);
    expect(unusable.text).toContain("could not refresh the OSV database, and no copy was refreshed in the last 7 days");

    const never = await gate(repo, await sandbox({ FAKE_OSV_UNREACHABLE: "1" }), head);
    expect(never.exitCode).toBe(2);
  },
  120_000,
);

test(
  "a bun.lock with no package scans clean, and leaves the next scan to refresh the database",
  async () => {
    const repo = await open({ "README.md": "# fixture\n" });
    const base = await repo.commit("docs: readme");
    await repo.write({ "bun.lock": lockfile({}) });
    const empty = await repo.commit("chore: lock with no package");
    const box = await sandbox();

    const green = await gate(repo, box, base, empty);
    expect(green.exitCode).toBe(0);
    expect(green.text).toContain("advisories: the range adds no advisory to bun.lock (0 at the head predate the range, 0 acknowledged)");

    await repo.write({ "bun.lock": lockfile({ lodash: "4.17.20" }) });
    const head = await repo.commit("build: add lodash");
    const red = await gate(repo, box, empty, head);
    expect(red.exitCode).toBe(1);
    expect(red.text).toContain("  lodash@4.17.20 GHSA-35jh-r3h4-6jhm high: Command Injection in lodash");
    expect((await box.calls()).map((call) => call.includes("--download-offline-databases"))).toEqual([true, true]);
  },
  120_000,
);

test(
  "checks-lint runs the gate in a repository that tracks bun.lock, which refuses a cached scanner that is not the pinned build",
  async () => {
    const build = Option.getOrThrow(buildFor(process.platform, process.arch));
    const repo = await open({ ...lintWiring(), "bun.lock": lockfile({ "left-pad": "1.3.0" }) });
    await repo.commit("chore: wire");
    await repo.write({ "bun.lock": lockfile({ "left-pad": "1.3.0", minimist: "0.0.8" }) });
    await repo.commit("build: add minimist");
    const box = await sandbox();
    const cached = join(box.home, ".cache", "avi2dg-checks", "osv-scanner", OSV_SCANNER_VERSION, build.asset);
    await mkdir(dirname(cached), { recursive: true });
    await copyFile(box.scanner, cached);
    const lint = await ran($`${process.execPath} ${join(CHECKOUT, "src", "core", "lint.ts")}`.cwd(repo.dir).env(box.env));
    expect(lint.exitCode).toBe(2);
    expect(lint.text).toContain(`${cached} has SHA-256 `);
    expect(lint.text).toContain(`not the pinned ${build.sha256}; delete it and rerun`);
    expect(lint.text).toContain("gate(s) failed: checks-advisories");
    expect(await box.calls()).toEqual([]);
  },
  120_000,
);
