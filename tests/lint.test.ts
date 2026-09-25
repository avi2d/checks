import { Effect } from "effect";
import { expect, test } from "bun:test";
import {
  decodePullRequestEvent,
  describe,
  localEndsOf,
  originRefOf,
  pullRequestEndsOf,
  rangeOf,
  selectEnds,
} from "../scripts/lint.ts";

test("rangeOf collapses to a lone tip when merge-base found the head itself, or keeps the range otherwise", () => {
  expect(rangeOf("abc", "abc")).toEqual(["abc"]);
  expect(rangeOf("abc", "def")).toEqual(["abc", "def"]);
});

test("describe formats a lone tip and a base..head range", () => {
  expect(describe({ refs: ["abc"], source: "" })).toBe("tip abc");
  expect(describe({ refs: ["abc", "def"], source: "" })).toBe("range abc..def");
});

test("originRefOf picks the ref git symbolic-ref resolved, or falls back to origin/<defaultBranch>", () => {
  expect(originRefOf("origin/trunk", "main")).toBe("origin/trunk");
  expect(originRefOf(undefined, "trunk")).toBe("origin/trunk");
});

test("localEndsOf judges HEAD alone with no remote-tracking refs, otherwise HEAD against the origin ref", () => {
  expect(localEndsOf(undefined)).toEqual({
    base: "HEAD",
    head: "HEAD",
    source: "HEAD alone, as the clone has no remote-tracking refs",
  });
  expect(localEndsOf("origin/trunk")).toEqual({
    base: "origin/trunk",
    head: "HEAD",
    source: "HEAD against origin/trunk",
  });
});

test("selectEnds reads explicit refs, refuses one alone, and otherwise defers to the pull request event or local resolution", () => {
  expect(selectEnds(["base", "head"], undefined, undefined)).toEqual({ kind: "explicit", base: "base", head: "head" });
  expect(selectEnds(["base"], undefined, undefined)).toEqual({ kind: "usage" });
  expect(selectEnds([], "pull_request", "/tmp/event.json")).toEqual({ kind: "pull-request", path: "/tmp/event.json" });
  expect(selectEnds([], "pull_request", undefined)).toEqual({ kind: "pull-request-unresolved" });
  expect(selectEnds([], undefined, undefined)).toEqual({ kind: "local" });
  expect(selectEnds([], "push", undefined)).toEqual({ kind: "local" });
});

test("pullRequestEndsOf reads the range ends an already-decoded pull request event describes", () => {
  expect(pullRequestEndsOf({ number: 7, base: { ref: "main" }, head: { sha: "abc123" } })).toEqual({
    base: "origin/main",
    head: "abc123",
    source: "pull request #7 into main",
  });
});

test("decodePullRequestEvent decodes a well-formed event and refuses one missing the head sha", () => {
  const event = JSON.stringify({ pull_request: { number: 7, base: { ref: "main" }, head: { sha: "abc123" } } });
  expect(Effect.runSync(decodePullRequestEvent(event))).toEqual({
    pull_request: { number: 7, base: { ref: "main" }, head: { sha: "abc123" } },
  });

  const malformed = JSON.stringify({ pull_request: { base: { ref: "main" } } });
  expect(() => Effect.runSync(decodePullRequestEvent(malformed))).toThrow();
});
