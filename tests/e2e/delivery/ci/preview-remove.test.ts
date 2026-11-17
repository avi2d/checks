import { afterEach, beforeEach, expect, test } from "bun:test";
import { type StubApi, apiEnv, runCi, startStubApi, useScratch } from "../../lib/ci-command.ts";

const MAIN = "preview-remove";
const DEPLOYMENTS = "/cf/accounts/acct/pages/projects/site-preview/deployments";
const MARKER = "<!-- site-preview -->";
const BOT = "github-actions[bot]";

const deployment = (id: string, branch: string) => ({ id, deployment_trigger: { metadata: { branch } } });

const scratch = useScratch("preview-remove");
let stub: StubApi;
let pages: ReturnType<typeof deployment>[][] = [];
let undeletable = "";

beforeEach(() => {
  undeletable = "";
  pages = [
    [deployment("a", "feature"), deployment("b", "other")],
    [deployment("c", "feature")],
  ];
  stub = startStubApi((method, path) => {
    const listed = new RegExp(`^${DEPLOYMENTS}\\?env=preview&per_page=25&page=([0-9]+)$`).exec(path);
    if (method === "GET" && listed !== null) {
      return { status: 200, body: { success: true, result: pages[Number(listed[1]) - 1] ?? [], result_info: { total_pages: pages.length } } };
    }
    const deleted = new RegExp(`^${DEPLOYMENTS}/([a-z]+)\\?force=true$`).exec(path);
    if (method === "DELETE" && deleted !== null) {
      const id = deleted[1];
      if (id !== undeletable) pages = pages.map((page) => page.filter((entry) => entry.id !== id));
      return { status: 200, body: { success: true } };
    }
    if (method === "GET" && path === "/gh/repos/owner/site/issues/7/comments?per_page=100&page=1") {
      return { status: 200, body: [{ id: 5, body: `${MARKER}\nPreview`, user: { login: BOT } }] };
    }
    if (method === "PATCH" && path === "/gh/repos/owner/site/issues/comments/5") return { status: 200, body: { id: 5 } };
    return undefined;
  });
});

afterEach(async () => {
  await stub.stop();
});

function remove() {
  return runCi(MAIN, [], {
    ...apiEnv(stub, scratch.at("output")),
    PULL_REQUEST: "7",
    MARKER,
    AUTHOR: BOT,
    PROJECT: "site-preview",
    BRANCH: "feature",
  });
}

test("a removal that misses the branch's later page or deletes another branch's deployment fails", async () => {
  const ran = await remove();
  expect(ran.exitCode).toBe(0);
  expect(stub.requests.filter(({ method }) => method === "DELETE").map(({ path }) => path)).toEqual([
    `${DEPLOYMENTS}/a?force=true`,
    `${DEPLOYMENTS}/c?force=true`,
  ]);
  expect(pages.flat().map(({ id }) => id)).toEqual(["b"]);
  expect(scratch.read("output")).toBe("");
});

test("a removal left unsaid on the pull request fails", async () => {
  await remove();
  expect(stub.requests.filter(({ method }) => method === "PATCH").map(({ body }) => body)).toEqual([
    { body: `${MARKER}\nPreview removed: the pull request closed and its 2 deployment(s) on Cloudflare Pages were deleted.` },
  ]);
});

test("a deployment Cloudflare still lists after the delete that passes fails", async () => {
  undeletable = "c";
  const ran = await remove();
  expect(ran.exitCode).toBe(1);
  expect(ran.stdout).toContain("::error::the Cloudflare API still lists 1 deployment(s) of feature after the delete");
});
