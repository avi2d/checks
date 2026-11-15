import { expect, test } from "bun:test";
import { byHandSet, differencesOf, requiredSet } from "../../../src/delivery/workflow-set.ts";

test("the code set is ci, pr-title, main and release, and the site set adds preview-close and production", () => {
  expect(requiredSet("code").map(({ name }) => name)).toEqual(["ci.yml", "pr-title.yml", "main.yml", "release.yml"]);
  expect(requiredSet("site").map(({ name }) => name)).toEqual(["ci.yml", "pr-title.yml", "preview-close.yml", "main.yml", "release.yml", "production.yml"]);
});

test("the two kinds share pr-title and release byte for byte, so neither drifts between sites and code", () => {
  const code = new Map(requiredSet("code").map(({ name, text }) => [name, text]));
  const site = new Map(requiredSet("site").map(({ name, text }) => [name, text]));
  expect(site.get("pr-title.yml")).toBe(code.get("pr-title.yml") ?? "no pr-title.yml");
  expect(site.get("release.yml")).toBe(code.get("release.yml") ?? "no release.yml");
  expect(site.get("ci.yml")).not.toBe(code.get("ci.yml"));
});

test("an absent by-hand caller is no difference, but one that runs its own steps is", () => {
  const written = requiredSet("code");
  expect(differencesOf("code", written)).toEqual([]);
  expect(byHandSet("site").map(({ name }) => name)).toEqual(["advisories.yml"]);
  const handRolled = { name: "mutation.yml", text: "name: mutation\non:\n  workflow_dispatch:\n" };
  expect(differencesOf("code", [...written, handRolled]).map(({ kind, name }) => [kind, name])).toEqual([["differs", "mutation.yml"]]);
  expect(differencesOf("site", [...requiredSet("site"), handRolled]).map(({ kind, name }) => [kind, name])).toEqual([["extra", "mutation.yml"]]);
});
