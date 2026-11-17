import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { recordedCalls, runCi, stubBin, useScratch } from "../../lib/ci-command.ts";

const scratch = useScratch("lighthouse");
const MAIN = "lighthouse";
const SITE = join(import.meta.dir, "../../../fixtures/ci/lighthouse");

const CHROME_WRITES_ITS_PORT = `for arg in "$@"; do case "$arg" in --user-data-dir=*) printf '9222\\n/devtools/browser/stub\\n' > "\${arg#--user-data-dir=}/DevToolsActivePort" ;; esac; done
exec sleep 60`;

const LIGHTHOUSE_WRITES_THE_REPORT = `if [ -n "$FAIL_ONCE" ] && [ ! -e "$FAIL_ONCE" ]; then : > "$FAIL_ONCE"; exit 1; fi
for arg in "$@"; do case "$arg" in --output-path=*) printf '%s' "$REPORT" > "\${arg#--output-path=}" ;; esac; done`;

const LIGHTHOUSE_FAILS_AFTER_WRITING = `for arg in "$@"; do case "$arg" in --output-path=*) printf '%s' "$REPORT" > "\${arg#--output-path=}" ;; esac; done
exit 1`;

const RUNTIME_ERROR_REPORT = JSON.stringify({
  categories: { performance: { score: null }, accessibility: { score: null }, "best-practices": { score: null }, seo: { score: null } },
});

const REPORT = JSON.stringify({
  categories: { performance: { score: 0.97 }, accessibility: { score: 0.39 }, "best-practices": { score: 1 }, seo: { score: 0.69 } },
});

function audit(env: Readonly<Record<string, string>>, lighthouseStub = LIGHTHOUSE_WRITES_THE_REPORT) {
  stubBin(scratch.at("bin"), "chrome", CHROME_WRITES_ITS_PORT);
  stubBin(scratch.at("bin"), "lighthouse", lighthouseStub);
  scratch.write("summary", "");
  return runCi(MAIN, [], {
    PATH: `${scratch.at("bin")}:${process.env["PATH"] ?? ""}`,
    STUB_RECORD: scratch.at("calls"),
    SITE,
    CHROME: scratch.at("bin", "chrome"),
    LIGHTHOUSE: scratch.at("bin", "lighthouse"),
    REPORTS: scratch.at("reports"),
    REPORT,
    GITHUB_STEP_SUMMARY: scratch.at("summary"),
    ...env,
  });
}

const lighthouseUrls = () =>
  recordedCalls(scratch.at("calls"))
    .filter((call) => Array.isArray(call) && call.some((arg) => String(arg).startsWith("--output-path=")))
    .map((call) => (Array.isArray(call) ? new URL(String(call[0])).pathname : ""));

test("a site whose pages are not each audited the asked number of times through the Chrome the action started, or whose low scores fail the step, fails", async () => {
  const ran = await audit({ RUNS: "2" });
  expect(ran.exitCode).toBe(0);
  expect(lighthouseUrls()).toEqual(["/", "/", "/faults/", "/faults/"]);
  const portFlags = recordedCalls(scratch.at("calls")).filter((call) => Array.isArray(call) && call.includes("--port=9222"));
  expect(portFlags).toHaveLength(4);
  expect(scratch.read("summary")).toContain("| `/faults/` | 97 (97, 97) | 39 (39, 39) | 100 (100, 100) | 69 (69, 69) |");
  expect(readdirSync(scratch.at("reports")).toSorted()).toEqual(["01-index-run-1.json", "01-index-run-2.json", "02-faults-run-1.json", "02-faults-run-2.json"]);
});

test("a pages input that still audits the pages it does not name fails", async () => {
  const ran = await audit({ RUNS: "1", PAGES: "/faults/" });
  expect(ran.exitCode).toBe(0);
  expect(lighthouseUrls()).toEqual(["/faults/"]);
});

test("a Lighthouse run that fails once and is not tried again fails", async () => {
  const ran = await audit({ RUNS: "1", PAGES: "/", FAIL_ONCE: scratch.at("failed-once") });
  expect(ran.exitCode).toBe(0);
  expect(readFileSync(scratch.at("reports", "01-index-run-1.json"), "utf8")).toBe(REPORT);
  expect(recordedCalls(scratch.at("calls")).filter((call) => Array.isArray(call) && call.includes("--quiet"))).toHaveLength(2);
}, 20_000);

test("a Lighthouse runtime error that still writes its report and fails the step fails", async () => {
  const ran = await audit({ RUNS: "1", PAGES: "/", REPORT: RUNTIME_ERROR_REPORT }, LIGHTHOUSE_FAILS_AFTER_WRITING);
  expect(ran.exitCode).toBe(0);
  expect(scratch.read("summary")).toContain("| `/` | none | none | none | none |");
  expect(readFileSync(scratch.at("reports", "01-index-run-1.json"), "utf8")).toBe(RUNTIME_ERROR_REPORT);
  expect(recordedCalls(scratch.at("calls")).filter((call) => Array.isArray(call) && call.includes("--quiet"))).toHaveLength(3);
}, 30_000);

test("a chrome-path that does not exist and still audits fails", async () => {
  const ran = await audit({ CHROME: scratch.at("no-chrome") });
  expect(ran.exitCode).toBe(1);
  expect(ran.stdout).toContain(`::error::chrome-path names ${scratch.at("no-chrome")}, which does not exist`);
});

test("a site folder that was never built and still audits fails", async () => {
  const ran = await audit({ SITE: scratch.at("dist") });
  expect(ran.exitCode).toBe(1);
  expect(ran.stdout).toContain("which is not a folder");
});
