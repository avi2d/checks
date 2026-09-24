import { firstText, parseOutline, VERSION } from "./doc-outline.ts";
import { RELEASED } from "./doc-rules.ts";
import { CHANGE_GROUPS, type ChangeGroup } from "./doc-templates.ts";

export type Commit = {
  readonly sha: string;
  readonly date: string;
  readonly subject: string;
};

export type Cut = {
  readonly version: string;
  readonly date: string;
  readonly through: string;
};

export type Release = {
  readonly version: string;
  readonly date: string;
  readonly subjects: readonly string[];
};

type Entry = {
  readonly group: ChangeGroup;
  readonly text: string;
};

const CONVENTIONAL = /^([a-z]+)(?:\(([^()]*)\))?(!)?: (\S.*)$/;

const GROUP_OF_TYPE = new Map<string, ChangeGroup>([
  ["feat", "Features"],
  ["fix", "Fixes"],
  ["perf", "Performance"],
  ["revert", "Reverts"],
]);

// Only the subject is linted, and a squash merge's body is its branch's commit messages,
// so a breaking change is read from the subject's `!` and never from a footer.
function entryOf(subject: string): Entry | undefined {
  const [, type = "", scope = "", breaking, description = ""] = CONVENTIONAL.exec(subject) ?? [];
  const group = breaking === "!" ? "Breaking changes" : GROUP_OF_TYPE.get(type);
  if (group === undefined) return undefined;
  return { group, text: scope === "" ? description : `**${scope}:** ${description}` };
}

export function releases(history: readonly Commit[], tagged: readonly Cut[], pending: Cut | undefined): readonly Release[] {
  const reach = ({ through }: Cut) => history.findIndex(({ sha }) => sha === through) + 1;
  const cuts = [...tagged.toSorted((a, b) => reach(a) - reach(b)), ...(pending === undefined ? [] : [pending])];
  let from = 0;
  const found = cuts.map((cut) => {
    const to = Math.max(from, reach(cut));
    const subjects = history.slice(from, to).map(({ subject }) => subject);
    from = to;
    return { version: cut.version, date: cut.date, subjects: subjects.toReversed() };
  });
  return found.toReversed();
}

function renderRelease({ version, date, subjects }: Release): readonly string[] {
  const entries = subjects.flatMap((subject) => entryOf(subject) ?? []);
  const groups = CHANGE_GROUPS.flatMap((group) => {
    const listed = entries.filter((entry) => entry.group === group).map(({ text }) => `- ${text}`);
    return listed.length === 0 ? [] : [`### ${group}`, listed.join("\n")];
  });
  return [`## ${version}`, `Released ${date}.`, ...groups];
}

export function renderChangelog(name: string, found: readonly Release[]): string {
  const blocks = [
    "# Changelog",
    `Every release of \`${name}\`, newest first, written by the release from its conventional commits.`,
    ...found.flatMap(renderRelease),
  ];
  return `${blocks.join("\n\n")}\n`;
}

export function releaseDates(text: string): ReadonlyMap<string, string> {
  return new Map(
    parseOutline(text).sections.flatMap(({ heading, body }) => {
      const date = RELEASED.exec(firstText(body)?.text.trim() ?? "")?.[1];
      return VERSION.test(heading.title) && date !== undefined ? [[heading.title, date] as const] : [];
    }),
  );
}
