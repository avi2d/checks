import { beforeEach, expect, test } from "bun:test";
import { runCi, stubBin, useScratch } from "../../lib/ci-command.ts";

const MAIN = "preview-deploy";
const ORIGIN = "https://feature.site-preview.pages.dev";
const DETAIL = (alias: string) => JSON.stringify({ type: "pages-deploy-detailed", alias });

const scratch = useScratch("preview-deploy");

beforeEach(() => {
  stubBin(scratch.at("bin"), "bunx", `printf '%s\\n' "$DEPLOY_DETAIL" >> "$WRANGLER_OUTPUT_FILE_PATH"\nexit \${BUNX_EXIT:-0}`);
});

function deploy(detail: string, overrides: Readonly<Record<string, string>> = {}) {
  return runCi(MAIN, [], {
    PATH: `${scratch.at("bin")}:${process.env["PATH"] ?? ""}`,
    STUB_RECORD: scratch.at("calls"),
    RUNNER_TEMP: scratch.at(),
    DEPLOY_DETAIL: detail,
    CLOUDFLARE_API_TOKEN: "cf-token-value",
    CLOUDFLARE_ACCOUNT_ID: "acct",
    WRANGLER_VERSION: "4.168.0",
    DIRECTORY: "dist",
    PROJECT: "site-preview",
    BRANCH: "Feature",
    COMMIT_HASH: "0123456789abcdef0123456789abcdef01234567",
    COMMIT_DIRTY: "true",
    ORIGIN,
    ...overrides,
  });
}

test("a preview Cloudflare serves at the origin the build points to that fails passes", async () => {
  const ran = await deploy(DETAIL(ORIGIN));
  expect(ran.exitCode).toBe(0);
  expect(ran.stdout).toContain(`Cloudflare serves Feature at ${ORIGIN}`);
  expect(scratch.read("calls")).toContain('"--branch","Feature","--commit-hash","0123456789abcdef0123456789abcdef01234567","--commit-dirty=true"]');
});

test("a preview served at another alias than the build points to that passes fails", async () => {
  const ran = await deploy(DETAIL("https://feature.site-preview-abc.pages.dev"));
  expect(ran.exitCode).toBe(1);
  expect(ran.stdout).toContain(`::error::Cloudflare serves the branch at 'https://feature.site-preview-abc.pages.dev', not at the ${ORIGIN} the build points to`);
});

test("an earlier deploy's alias left in the output file answering for this one passes", async () => {
  scratch.write("preview-deploy-output.ndjson", `${DETAIL(ORIGIN)}\n`);
  const ran = await deploy("not json");
  expect(ran.exitCode).toBe(1);
  expect(ran.stdout).toContain(`::error::Cloudflare serves the branch at '', not at the ${ORIGIN} the build points to`);
});

test("a wrangler failure that passes fails", async () => {
  expect((await deploy(DETAIL(ORIGIN), { BUNX_EXIT: "1" })).exitCode).toBe(1);
});
