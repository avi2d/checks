import { afterEach, beforeEach, expect, test } from "bun:test";
import { apiEnv, runCi, startStubApi, useScratch, type StubApi } from "../../lib/ci-command.ts";
const LIST = "/gh/repos/owner/site/releases?per_page=100";
const FULL_PAGE = Array.from({ length: 100 }, (_, index) => ({ id: 1000 + index, tag_name: `v0.${index}.0` }));

const scratch = useScratch("github-release");
let stub: StubApi;
let secondPage: { id: number; tag_name: string }[];

beforeEach(() => {
  secondPage = [{ id: 7, tag_name: "v1.4.0" }];
  stub = startStubApi((method, path) => {
    if (method === "GET" && path === `${LIST}&page=1`) return { status: 200, body: FULL_PAGE };
    if (method === "GET" && path === `${LIST}&page=2`) return { status: 200, body: secondPage };
    if (method === "POST" && path === "/gh/repos/owner/site/releases") return { status: 201, body: { id: 99 } };
    if (method === "PATCH" && path === "/gh/repos/owner/site/releases/7") return { status: 200, body: { id: 7 } };
    return undefined;
  });
});

afterEach(async () => {
  await stub.stop();
});

function release(tag: string, notesFile = scratch.at("notes.md"), refType = "tag") {
  scratch.write("notes.md", "## Fixed\n\n- a thing\n");
  return runCi("github-release", [], { ...apiEnv(stub, scratch.at("output")), TAG: tag, REF_TYPE: refType, NOTES_FILE: notesFile });
}

const writes = () => stub.requests.filter(({ method }) => method !== "GET");

test("a release that exists only on the second page created again in place of updated fails", async () => {
  const ran = await release("v1.4.0");
  expect(ran.exitCode).toBe(0);
  expect(stub.requests.filter(({ method }) => method === "GET").map(({ path }) => path)).toEqual([`${LIST}&page=1`, `${LIST}&page=2`]);
  expect(writes()).toEqual([
    {
      method: "PATCH",
      path: "/gh/repos/owner/site/releases/7",
      authorization: "Bearer gh-token-value",
      body: { tag_name: "v1.4.0", name: "v1.4.0", body: "## Fixed\n\n- a thing\n", draft: false, prerelease: false, make_latest: "true" },
    },
  ]);
});

test("a new tag below the highest release posted as latest fails", async () => {
  const ran = await release("v1.3.1");
  expect(ran.exitCode).toBe(0);
  expect(writes().map(({ method, path, body }) => [method, path, body])).toEqual([
    ["POST", "/gh/repos/owner/site/releases", { tag_name: "v1.3.1", name: "v1.3.1", body: "## Fixed\n\n- a thing\n", draft: false, prerelease: false, make_latest: "false" }],
  ]);
});

test("a branch run that releases the branch name fails", async () => {
  const ran = await release("main", scratch.at("notes.md"), "branch");
  expect(ran.exitCode).toBe(1);
  expect(ran.stdout).toContain("::error::github-release runs only on a tag");
  expect(writes()).toEqual([]);
});

test("missing notes that still write a release pass", async () => {
  const ran = await release("v1.5.0", scratch.at("absent.md"));
  expect(ran.exitCode).toBe(1);
  expect(ran.stdout).toContain(`::error::github-release cannot read ${scratch.at("absent.md")}`);
  expect(writes()).toEqual([]);
});
