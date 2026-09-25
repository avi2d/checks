import { afterEach, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { docsRepo, type DocsRepo } from "./lib/docs-repo.ts";

const FIXTURES = join(resolve(import.meta.dir, "..", ".."), "tests", "fixtures", "docs");
const GUIDE = "tools/README.md";
const OPENING = "# Tools\n\nThe tools build bills.\n";

type Plant = {
  readonly rule: string;
  readonly red: string;
  readonly refusal: string;
  readonly green: string;
};

const PLANTS: readonly Plant[] = [
  { rule: "an em dash", red: "It builds — and ships.", refusal: "4: carries `—`, an em dash", green: "It builds and ships." },
  { rule: "an en dash", red: "Pages 1–5 hold it.", refusal: "4: carries `–`, an en dash", green: "Pages 1 to 5 hold it." },
  { rule: "a parenthesis", red: "It builds (fast).", refusal: "4: carries `(`, a parenthesis", green: "It builds fast." },
  { rule: "a hyphen as a dash", red: "It builds - and ships.", refusal: "4: carries `-`, a hyphen used as a dash", green: "It builds and ships." },
  { rule: "a semicolon", red: "It builds; it ships.", refusal: "4: carries `;`, a semicolon", green: "It builds and ships." },
  {
    rule: "a promise about the future",
    red: "Windows support is planned.",
    refusal: "4: carries `is planned`, a promise about the future",
    green: "Windows is not supported.",
  },
  {
    rule: "a self-referential opener",
    red: "This page explains the tools.",
    refusal: "4: carries `This page explains`, a sentence that opens by talking about the page",
    green: "The tools build bills.",
  },
  {
    rule: "a second sentence on a line",
    red: "It builds. It ships.",
    refusal: "4: carries a second sentence on one line, which opens with `It ships`",
    green: "It builds.\nIt ships.",
  },
  {
    rule: "a sentence across lines",
    red: "It builds the bill and\nships it.",
    refusal: "4: carries a sentence that runs across lines",
    green: "It builds the bill and ships it.",
  },
];

let repo: DocsRepo | undefined;

afterEach(async () => {
  await repo?.dispose();
  repo = undefined;
});

test(
  "each prose rule goes red on a line a change adds to a living doc, and green once the line is rewritten",
  async () => {
    repo = await docsRepo({});
    const { put, commit, docs } = repo;
    await put(GUIDE, OPENING);
    let previous = await commit("start");
    for (const { rule, red, refusal, green } of PLANTS) {
      await put(GUIDE, `${OPENING}${red}\n`);
      const planted = await commit(`plant ${rule}`);
      const refused = await docs(previous, planted);
      expect(refused.text).toContain(`  ${GUIDE}:${refusal}`);
      expect(refused.exitCode).toBe(1);

      await put(GUIDE, `${OPENING}${green}\n`);
      const rewritten = await commit(`rewrite ${rule}`);
      const held = await docs(planted, rewritten);
      expect(held.text).toContain("living doc(s) or agent file(s) hold to the prose rules");
      expect(held.exitCode).toBe(0);
      previous = rewritten;
    }
  },
  120_000,
);

test(
  "a violation on a line the range leaves alone does not fail it, and editing that line does",
  async () => {
    repo = await docsRepo({});
    const { put, commit, docs } = repo;
    await put(GUIDE, `${OPENING}It builds; it ships.\n`);
    const base = await commit("a semicolon before the gate");
    await put(GUIDE, `${OPENING}It builds; it ships.\nIt reads the parts.\n`);
    const added = await commit("add a clean line");

    const untouched = await docs(base, added);
    expect(untouched.text).toContain("docs: 1 line(s) the range adds or edits in 1 living doc(s) or agent file(s) hold to the prose rules");
    expect(untouched.exitCode).toBe(0);

    await put(GUIDE, `${OPENING}It builds; it ships fast.\nIt reads the parts.\n`);
    const edited = await commit("edit the old line");
    const refused = await docs(added, edited);
    expect(refused.text).toContain(`  ${GUIDE}:4: carries \`;\`, a semicolon. Use two sentences`);
    expect(refused.exitCode).toBe(1);
  },
  120_000,
);

test(
  "a record, a changelog and fenced code take no prose rule",
  async () => {
    repo = await docsRepo({});
    const { put, commit, docs } = repo;
    const base = await commit("start");
    const record = await readFile(join(FIXTURES, "adr.md"), "utf8");
    await put("docs/adr/0001-a-part-names-its-supplier.md", `${record}\nIt builds; it ships (fast) — twice.\n`);
    await put("tools/CHANGELOG.md", "It builds; it ships (fast) — twice.\n");
    await put(GUIDE, `${OPENING}\n\`\`\`sh\nbuild; ship (fast) — twice\n\`\`\`\n`);
    const head = await commit("separators where the prose rules do not reach");

    const held = await docs(base, head);
    expect(held.text).toContain("living doc(s) or agent file(s) hold to the prose rules");
    expect(held.exitCode).toBe(0);
  },
  120_000,
);

test(
  "an agent file takes the separator rules and no sentence or people-doc rule",
  async () => {
    repo = await docsRepo({});
    const { put, commit, docs } = repo;
    await put("tools/AGENTS.md", "# Tools\n");
    const base = await commit("start");
    await put("tools/AGENTS.md", "# Tools\n\nIt builds. It ships.\nThis page explains the tools, and Windows support is planned\nfor them.\n");
    const sentences = await commit("sentences an agent file keeps");

    const held = await docs(base, sentences);
    expect(held.text).toContain("docs: 4 line(s) the range adds or edits in 1 living doc(s) or agent file(s) hold to the prose rules");
    expect(held.exitCode).toBe(0);

    await put("tools/AGENTS.md", "# Tools\n\nIt builds. It ships.\nThis page explains the tools, and Windows support is planned\nfor them — twice; fast.\n");
    const separated = await commit("separators in an agent file");
    const refused = await docs(sentences, separated);
    expect(refused.text).toContain("docs: 2 violation(s):");
    expect(refused.text).toContain("  tools/AGENTS.md:5: carries `—`, an em dash");
    expect(refused.text).toContain("  tools/AGENTS.md:5: carries `;`, a semicolon");
    expect(refused.exitCode).toBe(1);
  },
  120_000,
);

test(
  "a changed line is judged in the doc it was changed in, whatever its path holds",
  async () => {
    repo = await docsRepo({});
    const { put, commit, docs } = repo;
    await put("README.md", "# Widget\n\nIt builds; it ships.\n");
    await put("b/README.md", "# B\n\nIt builds.\n");
    await put("my tools/README.md", "# My tools\n\nIt builds.\n");
    const base = await commit("start");
    await put("b/README.md", "# B\n\nIt builds; it ships.\n");
    await put("my tools/README.md", "# My tools\n\nIt builds; it ships.\n");
    const head = await commit("semicolons under b/ and under a path with a space");

    const refused = await docs(base, head);
    expect(refused.text).toContain("docs: 2 violation(s):");
    expect(refused.text).toContain("  b/README.md:3: carries `;`, a semicolon");
    expect(refused.text).toContain("  my tools/README.md:3: carries `;`, a semicolon");
    expect(refused.exitCode).toBe(1);
  },
  120_000,
);
