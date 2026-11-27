import { expect, test } from "bun:test";
import { Effect } from "effect";
import { NO_CALLER_OPTIONS } from "../../../src/delivery/caller-options.ts";
import { DEFAULT_CI_JOBS } from "../../../src/delivery/ci-jobs.ts";
import { callerSetOf, flagMismatchOf, parseSiteNameFlags, SITE_NAME_KEYS, SITE_NAME_VARIABLES, type SiteNameFlags } from "../../../src/delivery/site-names.ts";
import type { Workflow } from "../../../src/delivery/workflow-references.ts";

const AZALIALAW = { pages: "azalialaw", domain: "azalialaw.com", production: "azalialaw/azalialaw.com" };

const sited = (name: string, names: Readonly<Partial<Record<keyof typeof AZALIALAW, string>>> = {}): Workflow => {
  const env = Object.fromEntries(SITE_NAME_KEYS.flatMap((key) => (names[key] === undefined ? [] : [[SITE_NAME_VARIABLES[key], names[key]]])));
  return { path: `.github/workflows/${name}`, document: { name, env, jobs: { job: { "runs-on": "ubuntu-latest" } } }, text: "" };
};

const plain = (name: string): Workflow => ({ path: `.github/workflows/${name}`, document: { name, jobs: { job: { "runs-on": "ubuntu-latest" } } }, text: "" });

const PRIVATE_OPTIONS = { ...NO_CALLER_OPTIONS, checkRelease: true };

const setOf = (workflows: readonly Workflow[], flags: SiteNameFlags = {}) => Effect.runSync(callerSetOf(workflows, flags, "checks-workflows --write", false, false, true, false, false));
const faultOf = (workflows: readonly Workflow[], flags: SiteNameFlags = {}) =>
  Effect.runSync(Effect.flip(callerSetOf(workflows, flags, "checks-workflows --write", false, false, true, false, false))).message;

const assetsFaultOf = (workflows: readonly Workflow[], flags: SiteNameFlags, publicRepository: boolean) =>
  Effect.runSync(Effect.flip(callerSetOf(workflows, flags, "checks-workflows --write", false, false, true, publicRepository, false, undefined, true))).message;

test("releaseAssets in a site or a private repository is refused, instead of writing an assets job with no release to attach to or a runner checks-ci-wiring refuses", () => {
  expect(assetsFaultOf([], AZALIALAW, true)).toBe("checks.config.ts sets workflows.releaseAssets, but a site's main.yml holds no release job to attach the assets to, so remove it");
  expect(assetsFaultOf([], {}, false)).toBe("checks.config.ts sets workflows.releaseAssets in a private repository, where checks-ci-wiring refuses the macOS runner the assets job needs, so remove it");
  const attached = Effect.runSync(callerSetOf([], {}, "checks-workflows --write", false, false, true, true, false, undefined, true));
  expect(attached.options.releaseAssets).toBe(true);
});

test("platformPackages in a site, a private repository or a private package.json is refused, instead of writing a binaries job with no release, a runner checks-ci-wiring refuses or no main package to name the platform packages", () => {
  const packages = { binary: "acme", platforms: ["linux-x64"] } as const;
  const packagesFaultOf = (flags: SiteNameFlags, publishes: boolean, publicRepository: boolean) =>
    Effect.runSync(Effect.flip(callerSetOf([], flags, "checks-workflows --write", publishes, false, true, publicRepository, false, undefined, false, packages))).message;
  expect(packagesFaultOf(AZALIALAW, true, true)).toBe("checks.config.ts sets workflows.platformPackages, but a site's main.yml holds no release job to publish the packages from, so remove it");
  expect(packagesFaultOf({}, true, false)).toBe("checks.config.ts sets workflows.platformPackages in a private repository, where checks-ci-wiring refuses the hosted runners the binaries job needs, so remove it");
  expect(packagesFaultOf({}, false, true)).toBe("checks.config.ts sets workflows.platformPackages, but package.json is private, so no published package names the platform packages; remove it or publish package.json");
  const packaged = Effect.runSync(callerSetOf([], {}, "checks-workflows --write", true, false, true, true, false, undefined, false, packages));
  expect(packaged.options.platformPackages).toEqual(packages);
});

test("a repository whose workflows name no site is a code repository, so a ci.yml is never read as a site", () => {
  expect(setOf([])).toEqual({ kind: "code", ci: DEFAULT_CI_JOBS.code, options: PRIVATE_OPTIONS });
  expect(setOf([plain("ci.yml"), plain("pr-title.yml")])).toEqual({ kind: "code", ci: DEFAULT_CI_JOBS.code, options: PRIVATE_OPTIONS });
});

test("a workflow that names the site in its env makes a site, and the three names come from that env rather than from package.json", () => {
  expect(setOf([sited("ci.yml", AZALIALAW), sited("main.yml", AZALIALAW)])).toEqual({ kind: "site", names: AZALIALAW, ci: DEFAULT_CI_JOBS.site, options: PRIVATE_OPTIONS });
});

test("a site workflow that names only some of the three is refused with the flags that name the rest, so a site set is never written with blank names", () => {
  expect(faultOf([sited("ci.yml", { pages: "azalialaw" })])).toBe(
    "the site workflows name no domain and production, so run checks-workflows --write --domain <domain> --production <owner/name>",
  );
});

test("the three flags make a site of a repository with no site workflow, so a first site write needs no package.json field", () => {
  expect(setOf([], AZALIALAW)).toEqual({ kind: "site", names: AZALIALAW, ci: DEFAULT_CI_JOBS.site, options: PRIVATE_OPTIONS });
  expect(faultOf([], { pages: "azalialaw" })).toContain("--domain <domain> --production <owner/name>");
});

test("a flag replaces the name a workflow holds and the other names stay, so a renamed domain is not lost to the old one", () => {
  expect(setOf([sited("ci.yml", AZALIALAW)], { domain: "azalia.law" })).toEqual({ kind: "site", names: { ...AZALIALAW, domain: "azalia.law" }, ci: DEFAULT_CI_JOBS.site, options: PRIVATE_OPTIONS });
});

test("a flag that differs from the name a present workflow holds is reported, so setup never keeps the old name beside the renamed one", () => {
  expect(flagMismatchOf([sited("ci.yml", AZALIALAW)], { domain: "azalia.law" })).toBe(
    ".github/workflows/ci.yml passes domain azalialaw.com and --domain passes azalia.law, so rename with checks-workflows --write",
  );
  expect(flagMismatchOf([sited("ci.yml", AZALIALAW)], { domain: "azalialaw.com" })).toBeUndefined();
  expect(flagMismatchOf([], AZALIALAW)).toBeUndefined();
});

test("two workflows that name different sites are refused rather than one silently winning", () => {
  expect(faultOf([sited("ci.yml", AZALIALAW), sited("main.yml", { ...AZALIALAW, pages: "azalia" })])).toBe(
    ".github/workflows/ci.yml passes pages azalialaw and .github/workflows/main.yml passes pages azalia, so make the site workflows agree",
  );
});

test("a name that is no Pages project, domain or repository is refused, so a space or a newline never reaches a written caller", () => {
  expect(faultOf([], { ...AZALIALAW, domain: "azalialaw com" })).toContain("is not a domain, such as acme.example");
  expect(faultOf([], { ...AZALIALAW, pages: "Azalia_Law" })).toContain("is not a Cloudflare Pages project name, such as acme");
  expect(faultOf([], { ...AZALIALAW, production: "azalialaw.com" })).toContain("is not a repository, such as acme/acme.example");
});

test("a site name flag without a value or given twice does not parse, so --pages --write never names a project --write", () => {
  expect(parseSiteNameFlags(["--write", "--pages", "azalialaw"])).toEqual({ flags: { pages: "azalialaw" }, rest: ["--write"] });
  expect(parseSiteNameFlags(["--pages", "--write"])).toBeUndefined();
  expect(parseSiteNameFlags(["--pages"])).toBeUndefined();
  expect(parseSiteNameFlags(["--pages", "a", "--pages", "b"])).toBeUndefined();
});
