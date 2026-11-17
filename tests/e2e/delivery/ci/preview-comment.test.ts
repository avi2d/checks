import { afterEach, beforeEach, expect, test } from "bun:test";
import { type StubApi, apiEnv, runCi, startStubApi } from "../../lib/ci-command.ts";

const MAIN = "preview-comment";
const MARKER = "<!-- site-preview -->";
const BOT = "github-actions[bot]";
const BODY = `${MARKER}\nPreview of \`0123456\`: https://feature.site.pages.dev/`;

let stub: StubApi;
let comments: { id: number; body: string; user: { login: string } }[] = [];

beforeEach(() => {
  comments = [];
  stub = startStubApi((method, path) => {
    if (method === "GET" && path === "/gh/repos/owner/site/issues/7/comments?per_page=100&page=1") return { status: 200, body: comments };
    if (method === "POST" && path === "/gh/repos/owner/site/issues/7/comments") return { status: 201, body: { id: 99 } };
    if (method === "PATCH" && path.startsWith("/gh/repos/owner/site/issues/comments/")) return { status: 200, body: { id: 1 } };
    return undefined;
  });
});

afterEach(async () => {
  await stub.stop();
});

function comment(pullRequest = "7") {
  return runCi(MAIN, [], {
    ...apiEnv(stub, "/dev/null"),
    PULL_REQUEST: pullRequest,
    MARKER,
    AUTHOR: BOT,
    ORIGIN: "https://feature.site.pages.dev",
    HEAD_SHA: "0123456789abcdef0123456789abcdef01234567",
  });
}

const writes = () => stub.requests.filter(({ method }) => method !== "GET").map(({ method, path, body }) => [method, path, body]);

test("a first preview that edits nothing instead of posting a comment fails", async () => {
  comments = [{ id: 3, body: `${MARKER}\nold`, user: { login: "someone" } }];
  const ran = await comment();
  expect(ran.exitCode).toBe(0);
  expect(writes()).toEqual([["POST", "/gh/repos/owner/site/issues/7/comments", { body: BODY }]]);
});

test("a later preview that posts a second comment instead of editing the bot's fails", async () => {
  comments = [{ id: 4, body: `${MARKER}\nold`, user: { login: BOT } }];
  const ran = await comment();
  expect(ran.exitCode).toBe(0);
  expect(writes()).toEqual([["PATCH", "/gh/repos/owner/site/issues/comments/4", { body: BODY }]]);
});

test("a run outside a pull request that comments anywhere passes", async () => {
  const ran = await comment("");
  expect(ran.exitCode).toBe(1);
  expect(ran.stdout).toContain("::error::preview-comment needs the pull-request input to be a pull request number, not ''");
  expect(stub.requests).toEqual([]);
});
