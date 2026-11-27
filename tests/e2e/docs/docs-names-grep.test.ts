import { BunServices } from "@effect/platform-bun";
import { $ } from "bun";
import { expect, test } from "bun:test";
import { Effect } from "effect";
import { alternationsOf, linesHolding, linesMatching, type Syntax } from "../../../src/docs/doc-names.ts";
import { fixtureRepos } from "../lib/fixture-repo.ts";

const repository = fixtureRepos("checks-doc-names-");

const run = <A, E>(effect: Effect.Effect<A, E, BunServices.BunServices>): Promise<A> => Effect.runPromise(effect.pipe(Effect.provide(BunServices.layer)));

const META_NAMES = ["a.b", "x+y", "w*z", "q?r", "call()", "[set]", "k{2}", "or|else", "^start", "end$", "back\\slash", "(open", "close)", "sprocket", "sprocket-rule"];

const READ_AS_PATTERNS = "axb\nxxy\nwz\nqr\ncall\ns\nkk\nor\nstart here\nthe end\nback lash\n";
const OUTSIDE_DOCS = [".", ":(exclude)*.md"];
const HELD_LITERALLY = "const a = 'a.b';\nx+y\nw*z q?r\ncall()\n[set]\nk{2}\nor|else\n^start\nend$\nback\\slash\n(open\nclose)\nsprocket-rule\n";

async function fixedStringLines(dir: string, names: readonly string[]): Promise<string> {
  const listed = new Blob([`${names.join("\n")}\n`]);
  return (await $`git grep -I -F -h --no-color -f - HEAD -- ${OUTSIDE_DOCS} < ${listed}`.cwd(dir).nothrow().quiet()).stdout.toString();
}

const hasPcre = (await $`git -C ${import.meta.dir} grep -P -q -e . HEAD -- :/tests/e2e/docs/docs-names-grep.test.ts`.nothrow().quiet()).exitCode === 0;
const syntaxes: readonly Syntax[] = hasPcre ? ["-P", "-E"] : ["-E"];

for (const syntax of syntaxes) {
  test(`with ${syntax}, the escaped names select the lines -F selects, and no name matches as a pattern`, async () => {
    const { dir, write, commit } = await repository();
    await write({ "patterns.ts": READ_AS_PATTERNS, "literal.ts": HELD_LITERALLY, "notes.md": "sprocket only in a doc\n" });
    await commit("lines a pattern reading would match, and lines holding each name");
    const [alternation = ""] = alternationsOf(META_NAMES);

    const lines = await run(linesMatching(dir, "HEAD", syntax, alternation));

    const fixed = await fixedStringLines(dir, META_NAMES);
    expect(fixed).toBe(HELD_LITERALLY);
    expect(lines).toBe(fixed);
  });
}

test("names past what one PCRE pattern compiles split into alternations git accepts, and every held name is still found", async () => {
  const names = Array.from({ length: 12_000 }, (_, index) => `part.${index}(x)`);
  const held = names.filter((_, index) => index % 97 === 0);
  const { dir, write, commit } = await repository();
  await write({ "parts.ts": `${held.join("\n")}\n` });
  await commit("a file holding some of many names");

  const alternations = alternationsOf(names);
  const refused = await run(
    Effect.forEach(alternations, (alternation) => linesMatching(dir, "HEAD", hasPcre ? "-P" : "-E", alternation)).pipe(
      Effect.map((found) => found.filter((lines) => lines === undefined).length),
    ),
  );
  const found = await run(linesHolding(dir, "HEAD", names));

  expect(alternations.length).toBeGreaterThan(1);
  expect(refused).toBe(0);
  const fixed = await fixedStringLines(dir, names);
  expect(names.filter((name) => found.includes(name))).toEqual(names.filter((name) => fixed.includes(name)));
});
