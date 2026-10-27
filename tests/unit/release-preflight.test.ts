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

test("the publisher matters for the kit publish and for npm publish", () => {
  expect(publishesToNpm("run: ./node_modules/.bin/checks-release-publish")).toBe(true);
  expect(publishesToNpm("run: bun src/delivery/release-publish.ts")).toBe(true);
  expect(publishesToNpm("run: npm publish --provenance")).toBe(true);
  expect(publishesToNpm("run: bun run build")).toBe(false);
});

const kitStep = { run: "bun src/delivery/release-publish.ts" };
const lintStep = { run: "bun run lint" };

test("a publishing job without its own permissions inherits the workflow grant", () => {
  expect(grantsOidc({ permissions: { contents: "read", "id-token": "write" }, jobs: { publish: { steps: [kitStep] } } })).toBe(true);
});

test("a publishing job with its own permissions ignores the workflow grant", () => {
  expect(
    grantsOidc({
      permissions: { contents: "read", "id-token": "write" },
      jobs: { publish: { permissions: { contents: "read" }, steps: [kitStep] } },
    }),
  ).toBe(false);
});

test("a grant on another job mints no token for the publishing job", () => {
  expect(
    grantsOidc({
      permissions: { contents: "read" },
      jobs: {
        lint: { permissions: { "id-token": "write" }, steps: [lintStep] },
        publish: { steps: [kitStep] },
      },
    }),
  ).toBe(false);
});

test("a publishing job granting the token needs no workflow grant", () => {
  expect(
    grantsOidc({
      permissions: { contents: "read" },
      jobs: { publish: { permissions: { contents: "read", "id-token": "write" }, steps: [kitStep] } },
    }),
  ).toBe(true);
});

test("no grant anywhere mints no token", () => {
  expect(grantsOidc({ permissions: { contents: "read" } })).toBe(false);
  expect(grantsOidc({ permissions: { contents: "read" }, jobs: { publish: { steps: [kitStep] } } })).toBe(false);
  expect(grantsOidc({ permissions: "write-all" })).toBe(true);
  expect(grantsOidc(undefined)).toBe(false);
});
