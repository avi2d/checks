import { slotLabel, type FixedSlot, type HeadingRule, type OpenSlot, type Presence, type Slot } from "./doc-outline.ts";
import { MODES } from "./quality-file.ts";

export const KINDS = ["readme", "changelog", "adr", "agents", "claude", ...MODES] as const;
export type Kind = (typeof KINDS)[number];

export type Title =
  | { readonly type: "fixed"; readonly text: string }
  | { readonly type: "open"; readonly placeholder: string; readonly rule: HeadingRule; readonly prefix?: string };

export type Outlined = {
  readonly shape: "outline";
  readonly title: Title;
  readonly lead: readonly string[];
  readonly sections: readonly Slot[];
};

export type Exact = {
  readonly shape: "exact";
  readonly text: string;
};

export type Template = Outlined | Exact;

export const TEMPLATE_DIRECTORY = "templates";

export const ADR_STATUSES = ["Proposed", "Accepted", "Rejected", "Deprecated", "Superseded", "Retired"] as const;

const REQUIRED: Presence = { required: true };

function optional(omitWhen: string): Presence {
  return { required: false, omitWhen };
}

function fixed(text: string, presence: Presence, body: readonly string[], more: Partial<FixedSlot> = {}): FixedSlot {
  return { type: "fixed", text, presence, body, ...more };
}

function open(placeholder: string, rule: HeadingRule, presence: Presence, body: readonly string[], more: Partial<OpenSlot> = {}): OpenSlot {
  return { type: "open", placeholder, rule, presence, body, ...more };
}

function listed(words: readonly string[]): string {
  return words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} or ${words.at(-1) ?? ""}`;
}

const TROUBLESHOOTING = fixed("Troubleshooting", optional("no reader has met a failure worth naming yet"), [], {
  subsections: [open("<The symptom, or the error text>", "any", REQUIRED, ["<Cause. Resolution.>"])],
});

const RELATED_TOPICS = fixed("Related topics", optional("there is no other page to send the reader to"), [
  "- [<page title>](<path to the page>)",
]);

const BEFORE_YOU_BEGIN = fixed("Before you begin", REQUIRED, ["- <each prerequisite, with the version it is tested on>"]);

const STEPS = ["To <do the task>:", "", "1. <step>", "1. <step>"];

const MAINTAINING = [
  "Keep this file for knowledge useful to almost every future agent session in this project.",
  "Do not repeat what the codebase already shows; point to the authoritative file or command instead.",
  "Prefer rewriting or pruning existing entries over appending new ones.",
  "When updating this file, preserve this bar for all agents and keep entries concise.",
];

const CHANGE_GROUPS = ["Breaking changes", "Features", "Fixes", "Performance", "Reverts"];

export const TEMPLATES: Readonly<Record<Kind, Template>> = {
  readme: {
    shape: "outline",
    title: { type: "open", placeholder: "<name>", rule: "any" },
    lead: ["<Concept. Two to four sentences: what this is, who it is for, why you would use it.>"],
    sections: [
      BEFORE_YOU_BEGIN,
      fixed("Install", REQUIRED, ["To install <name>:", "", "1. <step>", "1. <step>", "", "<What you see when it worked.>"]),
      open("<Everyday task, verb first>", "verb-first", REQUIRED, STEPS),
      fixed("Where things are", REQUIRED, ["| Path | What it holds |", "| --- | --- |"]),
      TROUBLESHOOTING,
      RELATED_TOPICS,
    ],
  },
  changelog: {
    shape: "outline",
    title: { type: "fixed", text: "Changelog" },
    lead: ["Every release of <package>, newest first, written by the release from its conventional commits."],
    sections: [
      open("<version>", "version", REQUIRED, ["Released <YYYY-MM-DD>."], {
        subsections: CHANGE_GROUPS.map((group) =>
          fixed(group, optional("the release holds no such commit"), ["- <the commit's subject>"]),
        ),
      }),
    ],
  },
  adr: {
    shape: "outline",
    title: { type: "open", placeholder: "<number>. <The decision, as a sentence>", rule: "any" },
    lead: ["Date: <YYYY-MM-DD, the day the record was written>"],
    sections: [
      fixed("Status", REQUIRED, [`<${listed(ADR_STATUSES)} as its first word, then what it amends or what replaced it.>`]),
      fixed("Context", REQUIRED, ["<What forced a decision, and what was true when it was made.>"]),
      open("<Another part of the record, such as What was considered and rejected>", "any", optional("the record needs no more"), ["<Its text.>"], {
        interleaved: true,
      }),
      fixed("Decision", REQUIRED, ["<What was decided, stated as what now holds.>"], { also: ["Decisions"] }),
      fixed("Consequences", optional("nothing follows from the decision but the decision"), [
        "<What follows from the decision, its cost included.>",
      ]),
    ],
  },
  agents: {
    shape: "outline",
    title: { type: "fixed", text: "Project agent memory" },
    lead: ["<What this repository is, in one sentence, and that README.md holds what a person reads.>"],
    sections: [
      open("<A topic an agent needs>", "any", optional("the lead holds every constraint"), [
        "- <A constraint an agent cannot infer from the code, and the file that holds its detail.>",
      ]),
      fixed("Maintaining this file", REQUIRED, MAINTAINING),
    ],
  },
  claude: {
    shape: "exact",
    text: "<!-- Points Claude at AGENTS.md via import; edit AGENTS.md, not this file. -->\n@AGENTS.md\n",
  },
  tutorial: {
    shape: "outline",
    title: { type: "open", prefix: "Tutorial: ", placeholder: "<Verb and what the reader builds>", rule: "verb-first" },
    lead: ["<What the reader builds, and what they learn on the way.>"],
    sections: [
      BEFORE_YOU_BEGIN,
      open("<Step, verb first>", "verb-first", REQUIRED, [...STEPS, "", "<What the reader sees now.>"]),
      TROUBLESHOOTING,
      RELATED_TOPICS,
    ],
  },
  "how-to": {
    shape: "outline",
    title: { type: "open", placeholder: "<Task, verb first>", rule: "verb-first" },
    lead: ["<Who does this, and when, in one or two sentences.>"],
    sections: [
      fixed("Before you begin", optional("the task needs nothing set up first"), BEFORE_YOU_BEGIN.body),
      open("<Part of the task, verb first>", "verb-first", optional("the page is one task, whose steps then follow the lead"), STEPS),
      TROUBLESHOOTING,
      RELATED_TOPICS,
    ],
  },
  reference: {
    shape: "outline",
    title: { type: "open", placeholder: "<The thing this page describes, as a noun>", rule: "any" },
    lead: ["<What the thing is, in one sentence, and when a reader looks it up.>"],
    sections: [
      open("<One part of it, as a noun>", "any", optional("the lead and one table describe all of it"), [
        "<A table, a list or a short description, with no steps and no opinion.>",
      ]),
      RELATED_TOPICS,
    ],
  },
  explanation: {
    shape: "outline",
    title: { type: "open", placeholder: "<The idea this page explains, as a noun>", rule: "any" },
    lead: ["<The question this page answers, and the short answer.>"],
    sections: [
      open("<One strand of the answer>", "any", optional("the lead holds the whole answer"), [
        "<The reasoning, the alternatives, and why they lost.>",
      ]),
      RELATED_TOPICS,
    ],
  },
};

function titleText(title: Title): string {
  return title.type === "fixed" ? title.text : `${title.prefix ?? ""}${title.placeholder}`;
}

function notes(slot: Slot): readonly string[] {
  const omit = slot.presence.required ? [] : [`<Leave this section out when ${slot.presence.omitWhen}.>`];
  const moves = slot.type === "open" && slot.interleaved === true ? ["<A section like this may also follow any section below it.>"] : [];
  return [...omit, ...moves];
}

function separated(blocks: readonly (readonly string[])[]): readonly string[] {
  return blocks.filter((block) => block.length > 0).flatMap((block, index) => (index === 0 ? block : ["", ...block]));
}

function renderSlot(slot: Slot, level: number): readonly string[] {
  return separated([
    [`${"#".repeat(level)} ${slotLabel(slot)}`],
    ...notes(slot).map((note) => [note]),
    slot.body,
    ...(slot.subsections ?? []).map((subsection) => renderSlot(subsection, level + 1)),
  ]);
}

export function renderTemplate(template: Template): string {
  if (template.shape === "exact") return template.text;
  const lines = separated([[`# ${titleText(template.title)}`], template.lead, ...template.sections.map((slot) => renderSlot(slot, 2))]);
  return `${lines.join("\n")}\n`;
}

export function templateFile(kind: Kind): string {
  return `${TEMPLATE_DIRECTORY}/${kind}.md`;
}
