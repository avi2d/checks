import { $ } from "bun";
import { expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CHECKOUT, ran, scratchDirs } from "./lib/fixture-repo.ts";

const scratch = scratchDirs();
const SCAN_MS = 120_000;
const NUMBER = "7";
const URL = "https://github.com/acme/widget/pull/7";
const PAT_FINDING = `  ${URL}#pullrequestreview-21:1 github-pat: Uncovered a GitHub Personal Access Token, potentially leading to unauthorized repository access and sensitive content exposure.`;

const fake = (prefix: string) => `${prefix}${randomBytes(4).toString("hex")}`;
// The token is assembled at run time, so the kit's own scan finds none in this file.
const githubToken = () => `${["gh", "p_"].join("")}${randomBytes(40).toString("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, 36)}`;

type Comment = { readonly id: number; readonly html_url: string; readonly body: string | null };

type PullRequest = {
  readonly title: string;
  readonly body: string | null;
  readonly comments: readonly (readonly Comment[])[];
  readonly reviews: readonly (readonly Comment[])[];
  readonly reviewComments: readonly (readonly Comment[])[];
};

const fileOf = (endpoint: string) => endpoint.replace(/[/{}]/g, "_");

// Puts a gh on PATH that logs each call and answers it from a file named after its last argument, the endpoint.
async function stubbedGh(pull: PullRequest): Promise<{ readonly dir: string; readonly calls: () => Promise<readonly string[]> }> {
  const dir = await scratch("checks-pr-text-gh-");
  const answers: Readonly<Record<string, unknown>> = {
    [`repos/{owner}/{repo}/pulls/${NUMBER}`]: { title: pull.title, body: pull.body, state: "open" },
    [`repos/{owner}/{repo}/issues/${NUMBER}/comments`]: pull.comments,
    [`repos/{owner}/{repo}/pulls/${NUMBER}/reviews`]: pull.reviews,
    [`repos/{owner}/{repo}/pulls/${NUMBER}/comments`]: pull.reviewComments,
  };
  for (const [endpoint, answer] of Object.entries(answers)) await writeFile(join(dir, fileOf(endpoint)), JSON.stringify(answer));
  await writeFile(
    join(dir, "gh"),
    `#!/bin/sh\necho "$*" >> "${dir}/calls"\nfor arg in "$@"; do endpoint=$arg; done\nfile="${dir}/$(printf '%s' "$endpoint" | tr '/{}' '___')"\n[ -f "$file" ] || { echo "HTTP 404: Not Found" >&2; exit 1; }\ncat "$file"\n`,
    { mode: 0o755 },
  );
  return { dir, calls: async () => (await readFile(join(dir, "calls"), "utf8").catch(() => "")).split("\n").filter((line) => line !== "") };
}

const prText = (gh: string, pack: string | undefined, number = NUMBER) =>
  ran(
    $`bun ${join(CHECKOUT, "src", "delivery", "pr-text.ts")} ${number}`
      .cwd(gh)
      .env({ ...process.env, PATH: `${gh}:${process.env["PATH"] ?? ""}`, ...(pack === undefined ? {} : { CHECKS_SECRETS_PACK: pack }) }),
  );

const comment = (id: number, body: string | null): Comment => ({ id, html_url: `${URL}#issuecomment-${id}`, body });

test(
  "a term of the pack in the title, the body or a comment on any page fails on the text that carries it, and no pack leaves only the kit's finding",
  async () => {
    const [first, last, domain, host] = [fake("Fakefirst"), fake("Fakelast"), `${fake("employer")}.example`, `${fake("build-")}.lan`];
    const token = githubToken();
    const gh = await stubbedGh({
      title: `feat: thanks ${first} ${last}`,
      body: `## Intent\n\nReach me at pat@${domain}\n`,
      comments: [[comment(11, "first page, nothing here")], [comment(12, `deployed on\n\n${host}`)]],
      reviews: [[{ id: 21, html_url: `${URL}#pullrequestreview-21`, body: `token=${token}` }, { id: 22, html_url: `${URL}#pullrequestreview-22`, body: null }]],
      reviewComments: [[]],
    });
    const pack = join(await scratch("checks-pr-text-pack-"), "pack.json");
    await writeFile(pack, JSON.stringify({ names: [`${first} ${last}`], domains: [domain], hosts: [host] }));

    const failed = await prText(gh.dir, pack);
    expect(failed.exitCode).toBe(1);
    expect(failed.text.split("\n").slice(1)).toEqual([
      "  the title:1 private-name: A name form the private pack lists",
      "  the body:3 private-domain: A domain the private pack lists",
      `  ${URL}#issuecomment-12:3 private-host: A host name the private pack lists`,
      PAT_FINDING,
      "pr-text: the kit's rules and the private pack CHECKS_SECRETS_PACK names ran",
      "",
    ]);
    for (const term of [first, last, domain, host, token, pack]) expect(failed.text.toLowerCase()).not.toContain(term.toLowerCase());
    expect((await gh.calls()).filter((call) => call.includes("/comments") || call.includes("/reviews")).every((call) => call.includes("--paginate --slurp"))).toBe(true);

    const unpacked = await prText(gh.dir, undefined);
    expect(unpacked.exitCode).toBe(1);
    expect(unpacked.text.split("\n").slice(1)).toEqual([
      PAT_FINDING,
      "pr-text: CHECKS_SECRETS_PACK is unset, so the kit's rules ran without a private pack",
      "",
    ]);
  },
  SCAN_MS,
);

test(
  "a pull request whose texts carry no term passes, and a pack set but missing fails before any call to GitHub",
  async () => {
    const gh = await stubbedGh({ title: "fix: tidy", body: null, comments: [[comment(31, "looks good")]], reviews: [[]], reviewComments: [[]] });
    const pack = join(gh.dir, "pack.json");
    await writeFile(pack, JSON.stringify({ names: [fake("Fakeperson")] }));
    expect(await prText(gh.dir, pack)).toEqual({
      exitCode: 0,
      text: `pr-text: pull request ${NUMBER} carries no secret and no private term\npr-text: the kit's rules and the private pack CHECKS_SECRETS_PACK names ran\n`,
    });

    const missing = await stubbedGh({ title: "fix: tidy", body: null, comments: [[]], reviews: [[]], reviewComments: [[]] });
    expect(await prText(missing.dir, join(missing.dir, "missing.json"))).toEqual({
      exitCode: 2,
      text: "pr-text: the private pack CHECKS_SECRETS_PACK names no file that exists, so the gate cannot scan for its terms\n",
    });
    expect(await missing.calls()).toEqual([]);
  },
  SCAN_MS,
);

test(
  "an argument that is not one pull request number and a failing gh api both fail the gate rather than pass it",
  async () => {
    const gh = await stubbedGh({ title: "fix: tidy", body: null, comments: [[]], reviews: [[]], reviewComments: [[]] });
    for (const number of ["0", "7x", ""]) {
      expect(await prText(gh.dir, undefined, number)).toEqual({ exitCode: 2, text: "pr-text: usage: pr-text.ts <pull-request-number>\n" });
    }
    const failed = await prText(gh.dir, undefined, "8");
    expect(failed.exitCode).toBe(2);
    expect(failed.text).toContain("HTTP 404: Not Found");
  },
  SCAN_MS,
);
