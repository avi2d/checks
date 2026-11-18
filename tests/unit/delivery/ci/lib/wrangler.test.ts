import { describe, expect, test } from "bun:test";
import { deployArgs, deployedAlias, type PagesDeploy } from "../../../../../src/delivery/ci/lib/wrangler.ts";

const MAIN: PagesDeploy = {
  wranglerVersion: "4.156.1",
  directory: "dist",
  project: "example-site",
  branch: "main",
  commitHash: "0123456789abcdef0123456789abcdef01234567",
  commitMessage: "Share preview of main",
  commitDirty: false,
};

describe("deployArgs", () => {
  test("a deploy that drops the project, branch, commit or the short commit at the end of the message fails", () => {
    expect(deployArgs(MAIN)).toEqual([
      "wrangler@4.156.1",
      "pages",
      "deploy",
      "dist",
      "--project-name",
      "example-site",
      "--branch",
      "main",
      "--commit-hash",
      "0123456789abcdef0123456789abcdef01234567",
      "--commit-message",
      "Share preview of main 0123456",
    ]);
  });

  test("an empty message passed to wrangler, or a dirty commit left unflagged, fails", () => {
    expect(deployArgs({ ...MAIN, commitMessage: "", commitDirty: true }).slice(-3)).toEqual(["--commit-hash", MAIN.commitHash, "--commit-dirty=true"]);
  });
});

describe("deployedAlias", () => {
  test("an alias read from a line other than the deploy detail fails", () => {
    const lines = [
      JSON.stringify({ type: "wrangler-session", version: 1 }),
      "",
      JSON.stringify({ type: "pages-deploy-detailed", alias: "https://feature.example-site-preview.pages.dev", url: "https://abc.example-site-preview.pages.dev" }),
      "not json",
    ];
    expect(deployedAlias(lines.join("\n"))).toBe("https://feature.example-site-preview.pages.dev");
  });

  test("an output without a deploy detail read as an alias passes", () => {
    expect(deployedAlias(JSON.stringify({ type: "pages-deploy", alias: "https://x.pages.dev" }))).toBe("");
  });
});
