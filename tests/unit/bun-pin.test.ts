import { expect, test } from "bun:test";
import { Effect } from "effect";
import { readFileSync } from "node:fs";
import { findBunPinFaults, formatBunPinReport, parseWorkflow, type BunPinFault, type BunPinPolicy } from "../../src/delivery/ci-wiring.ts";

// The oracle is the file the check reads, not a constant in the code.
const FLEET_BUN_VERSION = readFileSync(new URL("../../.bun-version", import.meta.url), "utf8").trim();

function workflow(text: string) {
  return [Effect.runSync(parseWorkflow(".github/workflows/ci.yml", text))];
}

function bunSteps(withBlock: string): string {
  return `on: pull_request\njobs:\n  checks:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: oven-sh/setup-bun@v2\n${withBlock}      - run: bun run lint\n`;
}

function bunPolicy(files: Record<string, string> = {}, manifests: Record<string, unknown> = {}, fleet: string = FLEET_BUN_VERSION): BunPinPolicy {
  return { files: new Map(Object.entries(files)), manifests: new Map(Object.entries(manifests)), fleet };
}

function bunFaults(text: string, policy: BunPinPolicy): readonly BunPinFault[] {
  return findBunPinFaults(policy, workflow(text));
}

const drifted = "1.3.13";

test("a setup-bun step pinned to the fleet version passes (oracle: setup-bun v2 with.bun-version input first)", () => {
  expect(bunFaults(bunSteps(`        with:\n          bun-version: ${FLEET_BUN_VERSION}\n`), bunPolicy())).toEqual([]);
});

test("the expected version comes from the policy, not a constant (oracle: an arbitrary policy fleet of 9.9.9)", () => {
  expect(bunFaults(bunSteps(`        with:\n          bun-version: 9.9.9\n`), bunPolicy({}, {}, "9.9.9"))).toEqual([]);
  const faults = bunFaults(bunSteps(`        with:\n          bun-version: ${FLEET_BUN_VERSION}\n`), bunPolicy({}, {}, "9.9.9"));
  expect(faults).toHaveLength(1);
  expect(faults[0]?.fault).toBe(`requests bun ${FLEET_BUN_VERSION} from with.bun-version, want 9.9.9`);
});

test("a setup-bun step pinned to an older version fails (oracle: a version below the fleet pin)", () => {
  const faults = bunFaults(bunSteps(`        with:\n          bun-version: ${drifted}\n`), bunPolicy());
  expect(faults).toHaveLength(1);
  expect(faults[0]?.location).toBe(".github/workflows/ci.yml line 6");
  expect(faults[0]?.fault).toBe(`requests bun ${drifted} from with.bun-version, want ${FLEET_BUN_VERSION}`);
});

test("an unquoted numeric bun-version wins over a fleet-pinned root manifest (oracle: GitHub hands setup-bun the scalar 1.4 as the string 1.4)", () => {
  const faults = bunFaults(bunSteps("        with:\n          bun-version: 1.4\n"), bunPolicy({}, { "package.json": { engines: { bun: FLEET_BUN_VERSION } } }));
  expect(faults).toEqual([{ location: ".github/workflows/ci.yml line 6", fault: `requests bun 1.4 from with.bun-version, want ${FLEET_BUN_VERSION}` }]);
});

test("a range never equals the fleet version (oracle: setup-bun v2 reuses the runner binary only on an exact match)", () => {
  for (const version of ["1.4", `^${FLEET_BUN_VERSION}`, `v${FLEET_BUN_VERSION}`]) {
    const faults = bunFaults(bunSteps(`        with:\n          bun-version: ${version}\n`), bunPolicy());
    expect(faults).toHaveLength(1);
    expect(faults[0]?.fault).toContain(`want ${FLEET_BUN_VERSION}`);
  }
  {
    const version = `>=${FLEET_BUN_VERSION}`;
    const faults = bunFaults(bunSteps(`        with:\n          bun-version: "${version}"\n`), bunPolicy());
    expect(faults).toHaveLength(1);
    expect(faults[0]?.fault).toContain(`want ${FLEET_BUN_VERSION}`);
  }
});

test("an expression cannot be shown equal before the run (oracle: setup-bun v2 substitutes with.bun-version at run time)", () => {
  const faults = bunFaults(bunSteps("        with:\n          bun-version: ${{ vars.BUN_VERSION }}\n"), bunPolicy());
  expect(faults).toHaveLength(1);
  expect(faults[0]?.fault).toContain("cannot be shown equal");
  expect(faults[0]?.fault).toContain(FLEET_BUN_VERSION);
});

test("a .bun-version file decides the pin (oracle: setup-bun v2 reads .bun-version as the whole trimmed file)", () => {
  const text = bunSteps("        with:\n          bun-version-file: .bun-version\n");
  expect(bunFaults(text, bunPolicy({ ".bun-version": `${FLEET_BUN_VERSION}\n` }))).toEqual([]);
  const faults = bunFaults(text, bunPolicy({ ".bun-version": `${drifted}\n` }));
  expect(faults).toHaveLength(1);
  expect(faults[0]?.fault).toBe(`requests bun ${drifted} from with.bun-version-file .bun-version, want ${FLEET_BUN_VERSION}`);
});

test("a .bumrc file decides the pin (oracle: setup-bun v2 reads .bumrc as the whole trimmed file)", () => {
  const text = bunSteps("        with:\n          bun-version-file: .bumrc\n");
  expect(bunFaults(text, bunPolicy({ ".bumrc": FLEET_BUN_VERSION }))).toEqual([]);
  expect(bunFaults(text, bunPolicy({ ".bumrc": drifted }))).toHaveLength(1);
});

test("a .tool-versions file reads the bun line (oracle: setup-bun v2 takes the bun line of .tool-versions)", () => {
  const text = bunSteps("        with:\n          bun-version-file: .tool-versions\n");
  expect(bunFaults(text, bunPolicy({ ".tool-versions": `nodejs 22.0.0\nbun ${FLEET_BUN_VERSION}\n` }))).toEqual([]);
  const faults = bunFaults(text, bunPolicy({ ".tool-versions": `bun ${drifted}\nnodejs 22.0.0\n` }));
  expect(faults).toHaveLength(1);
  expect(faults[0]?.fault).toContain(`requests bun ${drifted} from with.bun-version-file .tool-versions`);
});

test("a package.json version file reads packageManager then engines (oracle: setup-bun v2 reads packageManager after bun@, then engines.bun)", () => {
  const text = bunSteps("        with:\n          bun-version-file: apps/web/package.json\n");
  const key = "apps/web/package.json";
  expect(bunFaults(text, bunPolicy({}, { [key]: { packageManager: `bun@${FLEET_BUN_VERSION}` } }))).toEqual([]);
  expect(bunFaults(text, bunPolicy({}, { [key]: { engines: { bun: FLEET_BUN_VERSION } } }))).toEqual([]);
  expect(bunFaults(text, bunPolicy({}, { [key]: { packageManager: "pnpm@9.0.0", engines: { bun: FLEET_BUN_VERSION } } }))).toEqual([]);
  const faults = bunFaults(text, bunPolicy({}, { [key]: { packageManager: `bun@${drifted}`, engines: { bun: FLEET_BUN_VERSION } } }));
  expect(faults).toHaveLength(1);
  expect(faults[0]?.fault).toContain(`requests bun ${drifted} from with.bun-version-file ${key}`);
});

test("the inputs win in setup-bun order (oracle: setup-bun v2 tries with.bun-version, then with.bun-version-file, then the root package.json, then latest)", () => {
  const both = bunSteps(`        with:\n          bun-version: ${FLEET_BUN_VERSION}\n          bun-version-file: .bun-version\n`);
  expect(bunFaults(both, bunPolicy({ ".bun-version": drifted }))).toEqual([]);
  const versioned = bunSteps("        with:\n          bun-version-file: .bun-version\n");
  expect(bunFaults(versioned, bunPolicy({ ".bun-version": FLEET_BUN_VERSION }, { "package.json": { packageManager: `bun@${drifted}` } }))).toEqual([]);
  expect(bunFaults(bunSteps(""), bunPolicy({}, { "package.json": { engines: { bun: FLEET_BUN_VERSION } } }))).toEqual([]);
});

test("a version file that yields no version falls through to the root package.json (oracle: setup-bun v2 index.ts reads the root package.json when the named file gives none)", () => {
  const text = bunSteps("        with:\n          bun-version-file: .bun-version\n");
  expect(bunFaults(text, bunPolicy({}, { "package.json": { packageManager: `bun@${FLEET_BUN_VERSION}` } }))).toEqual([]);
  expect(bunFaults(text, bunPolicy({ ".bun-version": "\n" }, { "package.json": { packageManager: `bun@${FLEET_BUN_VERSION}` } }))).toEqual([]);
  expect(bunFaults(text, bunPolicy({}, { "package.json": { packageManager: `bun@${drifted}` } }))).toEqual([
    { location: ".github/workflows/ci.yml line 6", fault: `requests bun ${drifted} from package.json, want ${FLEET_BUN_VERSION}` },
  ]);
  expect(bunFaults(text, bunPolicy())).toEqual([
    {
      location: ".github/workflows/ci.yml line 6",
      fault: `pins no bun version from with.bun-version-file .bun-version or package.json, so setup-bun installs latest, want ${FLEET_BUN_VERSION}`,
    },
  ]);
});

test("an indented bun line in .tool-versions yields no version (oracle: setup-bun utils.ts matches /^bun\\s*(?<version>.*?)$/m on the untrimmed file)", () => {
  const faults = bunFaults(bunSteps("        with:\n          bun-version-file: .tool-versions\n"), bunPolicy({ ".tool-versions": ` bun ${FLEET_BUN_VERSION}\n` }));
  expect(faults).toHaveLength(1);
  expect(faults[0]?.fault).toContain("installs latest");
});

test("a packageManager of bun@ yields no version and skips engines.bun (oracle: setup-bun utils.ts takes packageManager?.split(\"bun@\")?.[1] ?? engines?.bun, then trims)", () => {
  const faults = bunFaults(bunSteps(""), bunPolicy({}, { "package.json": { packageManager: "bun@", engines: { bun: FLEET_BUN_VERSION } } }));
  expect(faults).toEqual([{ location: ".github/workflows/ci.yml line 6", fault: `pins no bun version from package.json, so setup-bun installs latest, want ${FLEET_BUN_VERSION}` }]);
});

test("a packageManager that is not bun falls through to engines.bun (oracle: setup-bun utils.ts takes packageManager?.split(\"bun@\")?.[1] ?? engines?.bun)", () => {
  expect(bunFaults(bunSteps(""), bunPolicy({}, { "package.json": { packageManager: "npm@10", engines: { bun: FLEET_BUN_VERSION } } }))).toEqual([]);
});

test("a comment naming setup-bun above a drifted step does not take its line (oracle: the step's uses line in the workflow text)", () => {
  const text = `on: pull_request\njobs:\n  checks:\n    runs-on: ubuntu-latest\n    steps:\n      # uses: oven-sh/setup-bun@v2\n      - uses: oven-sh/setup-bun@v2\n        with:\n          bun-version: ${drifted}\n`;
  expect(bunFaults(text, bunPolicy()).map(({ location }) => location)).toEqual([".github/workflows/ci.yml line 7"]);
});

test("nothing pinned means latest, which fails (oracle: setup-bun v2 installs latest when no source pins a version)", () => {
  const faults = bunFaults(bunSteps(""), bunPolicy());
  expect(faults).toHaveLength(1);
  expect(faults[0]?.fault).toBe(`pins no bun version from package.json, so setup-bun installs latest, want ${FLEET_BUN_VERSION}`);
  const missing = bunFaults(bunSteps("        with:\n          bun-version-file: .bun-version\n"), bunPolicy());
  expect(missing).toHaveLength(1);
  expect(missing[0]?.fault).toContain("installs latest");
});

test("a repository with no setup-bun step is not judged (oracle: the rule names only setup-bun steps)", () => {
  expect(bunFaults(`on: pull_request\njobs:\n  checks:\n    runs-on: ubuntu-latest\n    steps:\n      - run: bun run lint\n`, bunPolicy())).toEqual([]);
  expect(findBunPinFaults(bunPolicy(), [])).toEqual([]);
});

function usesStep(uses: string, version: string): string {
  return `on: pull_request\njobs:\n  checks:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: ${uses}\n        with:\n          bun-version: ${version}\n`;
}

test("a setup-bun step at a ref other than v2 is refused even with the fleet pin (oracle: the recorded decision that the check knows only setup-bun v2's resolution)", () => {
  for (const [uses, ref] of [["oven-sh/setup-bun@v1", "v1"], ["oven-sh/setup-bun@v3", "v3"], ["oven-sh/setup-bun@main", "main"], ["oven-sh/setup-bun@4bc047ad259df6fc24a6c9b0f9a0cb08cf17fbe5", "4bc047ad259df6fc24a6c9b0f9a0cb08cf17fbe5"], ["oven-sh/setup-bun", "no ref"]]) {
    expect(bunFaults(usesStep(uses ?? "", FLEET_BUN_VERSION), bunPolicy())).toEqual([
      { location: ".github/workflows/ci.yml line 6", fault: `uses oven-sh/setup-bun at ${ref}, but the check knows only setup-bun v2's version resolution, so the step must use oven-sh/setup-bun@v2` },
    ]);
  }
});

test("a setup-bun step at v2.2.0 is judged by its version (oracle: the recorded decision that v2, v2.<minor> and v2.<minor>.<patch> are v2)", () => {
  expect(bunFaults(usesStep("oven-sh/setup-bun@v2.2.0", FLEET_BUN_VERSION), bunPolicy())).toEqual([]);
  expect(bunFaults(usesStep("oven-sh/setup-bun@v2.2.0", drifted), bunPolicy())).toEqual([
    { location: ".github/workflows/ci.yml line 6", fault: `requests bun ${drifted} from with.bun-version, want ${FLEET_BUN_VERSION}` },
  ]);
});

test("an input name in another case still decides the version (oracle: the GitHub runner reads step inputs into an OrdinalIgnoreCase dictionary)", () => {
  const root = { "package.json": { engines: { bun: FLEET_BUN_VERSION } } };
  expect(bunFaults(bunSteps(`        with:\n          BUN-VERSION: ${drifted}\n`), bunPolicy({}, root))).toEqual([
    { location: ".github/workflows/ci.yml line 6", fault: `requests bun ${drifted} from with.bun-version, want ${FLEET_BUN_VERSION}` },
  ]);
  expect(bunFaults(bunSteps("        with:\n          Bun-Version-File: .bun-version\n"), bunPolicy({ ".bun-version": drifted }, root))).toEqual([
    { location: ".github/workflows/ci.yml line 6", fault: `requests bun ${drifted} from with.bun-version-file .bun-version, want ${FLEET_BUN_VERSION}` },
  ]);
});

test("another action is not judged (oracle: the rule names only setup-bun steps)", () => {
  const other = `on: pull_request\njobs:\n  checks:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 22\n`;
  expect(bunFaults(other, bunPolicy())).toEqual([]);
});

test("the bun pin report names each step and the fleet version", () => {
  const faults = bunFaults(bunSteps(`        with:\n          bun-version: ${drifted}\n`), bunPolicy());
  expect(formatBunPinReport(faults)).toBe(
    `ci-wiring: 1 setup-bun step(s) drift from the fleet bun version:\n  .github/workflows/ci.yml line 6: requests bun ${drifted} from with.bun-version, want ${FLEET_BUN_VERSION}`,
  );
});
