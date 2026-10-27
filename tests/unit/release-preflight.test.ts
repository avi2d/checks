import { expect, test } from "bun:test";
import { grantsOidc, ownerRepoOf, publishesToNpm } from "../../src/delivery/release-preflight.ts";

test("owner and name come from the https and ssh forms of a GitHub remote", () => {
  expect(ownerRepoOf("https://github.com/acme/widget.git")).toBe("acme/widget");
  expect(ownerRepoOf("git+https://github.com/acme/widget.git")).toBe("acme/widget");
  expect(ownerRepoOf("git@github.com:acme/widget.git")).toBe("acme/widget");
  expect(ownerRepoOf("https://github.com/acme/widget")).toBe("acme/widget");
});

test("anything but a GitHub owner and name has no repository to match", () => {
  expect(ownerRepoOf("https://example.com/acme/widget.git")).toBeUndefined();
  expect(ownerRepoOf("acme/widget")).toBeUndefined();
  expect(ownerRepoOf("")).toBeUndefined();
});

test("the publisher matters only when the workflow publishes to npm", () => {
  expect(publishesToNpm("run: ./node_modules/.bin/checks-release-publish")).toBe(true);
  expect(publishesToNpm("run: npm publish --provenance")).toBe(true);
  expect(publishesToNpm("run: bun run build")).toBe(false);
});

test("an OIDC token needs id-token write on the workflow or on the release job", () => {
  expect(grantsOidc({ permissions: { contents: "read", "id-token": "write" } })).toBe(true);
  expect(grantsOidc({ jobs: { publish: { permissions: { "id-token": "write" } } } })).toBe(true);
  expect(grantsOidc({ permissions: "write-all" })).toBe(true);
  expect(grantsOidc({ permissions: { contents: "read" } })).toBe(false);
  expect(grantsOidc({ jobs: { publish: { runs_on: "ubuntu-latest" } } })).toBe(false);
  expect(grantsOidc(undefined)).toBe(false);
});
