import { expect, test } from "bun:test";
import { reasonOf } from "../../../../../src/delivery/ci/lib/api.ts";

test("a Cloudflare error list or a GitHub error message left out of the failure fails", () => {
  expect(reasonOf(JSON.stringify({ errors: [{ message: "Authentication error" }, { message: "try again" }] }))).toBe(": Authentication error; try again");
  expect(reasonOf(JSON.stringify({ message: "Not Found" }))).toBe(": Not Found");
});

test("a body that is no error read as a reason passes", () => {
  expect(reasonOf("<html>bad gateway</html>")).toBe("");
  expect(reasonOf(JSON.stringify({ errors: [] }))).toBe("");
});
