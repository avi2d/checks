import { expect, test } from "bun:test";
import { Effect } from "effect";
import { NO_CALLER_OPTIONS } from "../../../src/delivery/caller-options.ts";
import { DEFAULT_CI_JOBS } from "../../../src/delivery/ci-jobs.ts";
import { callerSetOf, flagMismatchOf, parseSiteNameFlags, type SiteNameFlags } from "../../../src/delivery/site-names.ts";
import type { Workflow } from "../../../src/delivery/workflow-references.ts";

const AZALIALAW = { pages: "azalialaw", domain: "azalialaw.com", production: "azalialaw/azalialaw.com" };

const caller = (name: string, uses: string, inputs?: Readonly<Record<string, string>>): Workflow => {
  const job: Record<string, unknown> = { uses, ...(inputs === undefined ? {} : { with: inputs }) };
  return { path: `.github/workflows/${name}`, document: { name, jobs: { job } }, text: "" };
};

const PRIVATE_OPTIONS = { ...NO_CALLER_OPTIONS, checkRelease: true };

const SITE_CI = "avi2d/workflows/.github/workflows/site-ci.yml@v3";

const setOf = (workflows: readonly Workflow[], flags: SiteNameFlags = {}) => Effect.runSync(callerSetOf(workflows, flags, "checks-workflows --write", false));
const faultOf = (workflows: readonly Workflow[], flags: SiteNameFlags = {}) =>
  Effect.runSync(Effect.flip(callerSetOf(workflows, flags, "checks-workflows --write", false))).message;

test("a repository whose callers call only code workflows is a code repository, so a ci.yml caller is never read as a site", () => {
  expect(setOf([])).toEqual({ kind: "code", ci: DEFAULT_CI_JOBS.code, options: PRIVATE_OPTIONS });
  expect(setOf([caller("ci.yml", "avi2d/workflows/.github/workflows/ci.yml@v3"), caller("pr-title.yml", "avi2d/workflows/.github/workflows/pr-title.yml@v3")])).toEqual({ kind: "code", ci: DEFAULT_CI_JOBS.code, options: PRIVATE_OPTIONS });
});

test("a caller of a shared site workflow makes a site, and the three names come from what the callers pass rather than from package.json", () => {
  const callers = [caller("ci.yml", SITE_CI, AZALIALAW), caller("main.yml", "avi2d/workflows/.github/workflows/site-main.yml@v3", AZALIALAW)];
  expect(setOf(callers)).toEqual({ kind: "site", names: AZALIALAW, ci: DEFAULT_CI_JOBS.site, options: PRIVATE_OPTIONS });
});

test("a site caller that passes no names is refused with the flags that name them, so a site set is never written with blank names", () => {
  expect(faultOf([caller("ci.yml", SITE_CI)])).toBe(
    "the site callers pass no pages, domain and production, so run checks-workflows --write --pages <project> --domain <domain> --production <owner/name>",
  );
  expect(faultOf([caller("ci.yml", SITE_CI, { pages: "azalialaw" })])).toBe(
    "the site callers pass no domain and production, so run checks-workflows --write --domain <domain> --production <owner/name>",
  );
});

test("the three flags make a site of a repository with no caller, so a first site write needs no package.json field", () => {
  expect(setOf([], AZALIALAW)).toEqual({ kind: "site", names: AZALIALAW, ci: DEFAULT_CI_JOBS.site, options: PRIVATE_OPTIONS });
  expect(faultOf([], { pages: "azalialaw" })).toContain("--domain <domain> --production <owner/name>");
});

test("a flag replaces the name the callers pass and the other names stay, so a renamed domain is not lost to the old one", () => {
  expect(setOf([caller("ci.yml", SITE_CI, AZALIALAW)], { domain: "azalia.law" })).toEqual({ kind: "site", names: { ...AZALIALAW, domain: "azalia.law" }, ci: DEFAULT_CI_JOBS.site, options: PRIVATE_OPTIONS });
});

test("a flag that differs from the name a present caller passes is refused, so setup never keeps the old caller beside the renamed one", () => {
  expect(flagMismatchOf([caller("ci.yml", SITE_CI, AZALIALAW)], { domain: "azalia.law" })).toBe(
    ".github/workflows/ci.yml passes domain azalialaw.com and --domain passes azalia.law, so rename with checks-workflows --write",
  );
  expect(flagMismatchOf([caller("ci.yml", SITE_CI, AZALIALAW)], { domain: "azalialaw.com" })).toBeUndefined();
  expect(flagMismatchOf([], AZALIALAW)).toBeUndefined();
});

test("two callers that pass different names are refused rather than one silently winning", () => {
  const callers = [caller("ci.yml", SITE_CI, AZALIALAW), caller("main.yml", "avi2d/workflows/.github/workflows/site-main.yml@v3", { ...AZALIALAW, pages: "azalia" })];
  expect(faultOf(callers)).toBe(".github/workflows/ci.yml passes pages azalialaw and .github/workflows/main.yml passes pages azalia, so make the site callers agree");
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
