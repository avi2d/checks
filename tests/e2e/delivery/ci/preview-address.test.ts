import { afterEach, beforeEach, expect, test } from "bun:test";
import { type StubApi, apiEnv, runCi, startStubApi, useScratch } from "../../lib/ci-command.ts";

const MAIN = "preview-address";
const PROJECT_PATH = "/cf/accounts/acct/pages/projects/site-preview";

const scratch = useScratch("preview-address");
let stub: StubApi;
let exists = true;

beforeEach(() => {
  exists = true;
  stub = startStubApi((method, path) => {
    if (method === "GET" && path === PROJECT_PATH) {
      return exists ? { status: 200, body: { success: true, result: { subdomain: "site-preview-abc.pages.dev" } } } : undefined;
    }
    if (method === "POST" && path === "/cf/accounts/acct/pages/projects") {
      exists = true;
      return { status: 200, body: { success: true, result: { name: "site-preview" } } };
    }
    return undefined;
  });
});

afterEach(async () => {
  await stub.stop();
});

function address(branch: string) {
  return runCi(MAIN, [], {
    ...apiEnv(stub, scratch.at("output")),
    PROJECT: "site-preview",
    BRANCH: branch,
  });
}

const output = () => scratch.read("output");

test("an origin built on the project name rather than the host Cloudflare assigned fails", async () => {
  const ran = await address("Feature/Add_Login");
  expect(ran.exitCode).toBe(0);
  expect(output()).toBe("origin=https://feature-add-login.site-preview-abc.pages.dev\n");
  expect(stub.requests.map(({ method }) => method)).toEqual(["GET"]);
});

test("a missing project left uncreated fails", async () => {
  exists = false;
  const ran = await address("main");
  expect(ran.exitCode).toBe(0);
  expect(stub.requests.map(({ method, path, body }) => [method, path, body])).toEqual([
    ["GET", PROJECT_PATH, undefined],
    ["POST", "/cf/accounts/acct/pages/projects", { name: "site-preview", production_branch: "main" }],
    ["GET", PROJECT_PATH, undefined],
  ]);
  expect(output()).toBe("origin=https://main.site-preview-abc.pages.dev\n");
});

test("a branch with no letter or digit given an empty alias passes", async () => {
  const ran = await address("---");
  expect(ran.exitCode).toBe(1);
  expect(ran.stdout).toContain("::error::the branch --- leaves no letter or digit for a Pages alias");
  expect(output()).toBe("");
});
