import { expect, test } from "bun:test";
import { markedBy } from "../../../../../src/delivery/ci/lib/marker-comment.ts";

const MARKER = "<!-- site-preview -->";

test("a marked comment by another author, or a comment that only holds the marker later, picked over the bot's fails", () => {
  const comments = [
    { id: 1, body: `${MARKER}\nPreview`, user: { login: "someone" } },
    { id: 2, body: `quoting ${MARKER}`, user: { login: "github-actions[bot]" } },
    { id: 3, body: null, user: null },
    { id: 4, body: `${MARKER}\nPreview`, user: { login: "github-actions[bot]" } },
    { id: 5, body: `${MARKER}\nPreview`, user: { login: "github-actions[bot]" } },
  ];
  expect(markedBy(comments, MARKER, "github-actions[bot]")).toBe(4);
  expect(markedBy(comments.slice(0, 4).filter((comment) => comment.id !== 4), MARKER, "github-actions[bot]")).toBeUndefined();
});
