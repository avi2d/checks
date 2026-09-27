export type Line = {
  readonly line: number;
  readonly text: string;
};

export type Heading = {
  readonly level: number;
  readonly title: string;
  readonly line: number;
};

export type Section = {
  readonly heading: Heading;
  readonly body: readonly Line[];
  readonly subsections: readonly Section[];
};

export type Outline = {
  readonly lines: readonly Line[];
  readonly prose: readonly Line[];
  readonly headings: readonly Heading[];
  readonly lead: readonly Line[];
  readonly sections: readonly Section[];
};

export type Violation = {
  readonly line: number;
  readonly message: string;
};

export type HeadingRule = "any" | "version";

export type Presence = { readonly required: true } | { readonly required: false; readonly omitWhen: string };

type SlotShape = {
  readonly presence: Presence;
  readonly body: readonly string[];
  readonly subsections?: readonly Slot[];
};

export type FixedSlot = SlotShape & {
  readonly type: "fixed";
  readonly text: string;
  readonly also?: readonly string[];
};

export type OpenSlot = SlotShape & {
  readonly type: "open";
  readonly placeholder: string;
  readonly rule: HeadingRule;
  readonly interleaved?: true;
};

export type Slot = FixedSlot | OpenSlot;

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+|$)(.*)$/;
const CLOSING_HASHES = /(?:^|[ \t]+)#+[ \t]*$/;

function fenceCloses(text: string, opener: string): boolean {
  const closer = FENCE.exec(text)?.[1];
  return closer !== undefined && closer[0] === opener[0] && closer.length >= opener.length && text.trim() === closer;
}

function headingOf({ line, text }: Line): Heading | undefined {
  const match = HEADING.exec(text);
  if (match === null) return undefined;
  const [, hashes = "", rest = ""] = match;
  return { level: hashes.length, title: rest.replace(CLOSING_HASHES, "").trim(), line };
}

function between(lines: readonly Line[], after: number, before: number): readonly Line[] {
  return lines.filter(({ line }) => line > after && line < before);
}

function sectionsAt(level: number, headings: readonly Heading[], lines: readonly Line[], end: number): Section[] {
  return headings.flatMap((heading, index) => {
    if (heading.level !== level) return [];
    const next = headings.slice(index + 1);
    const close = next.find((other) => other.level <= level)?.line ?? end;
    const within = next.filter((other) => other.line < close);
    return [
      {
        heading,
        body: between(lines, heading.line, within[0]?.line ?? close),
        subsections: sectionsAt(level + 1, within, lines, close),
      },
    ];
  });
}

export function parseOutline(text: string): Outline {
  const lines = text.split("\n").map((raw, index) => ({ line: index + 1, text: raw.replace(/\r$/, "") }));
  const prose: Line[] = [];
  const headings: Heading[] = [];
  let fence: string | undefined;
  for (const line of lines) {
    if (fence !== undefined) {
      if (fenceCloses(line.text, fence)) fence = undefined;
      continue;
    }
    const opener = FENCE.exec(line.text)?.[1];
    if (opener !== undefined) {
      fence = opener;
      continue;
    }
    prose.push(line);
    const heading = headingOf(line);
    if (heading !== undefined) headings.push(heading);
  }
  const end = lines.length + 1;
  const titleLine = headings[0]?.level === 1 ? headings[0].line : 0;
  return {
    lines,
    prose,
    headings,
    lead: between(lines, titleLine, headings.find((heading) => heading.line > titleLine)?.line ?? end),
    sections: sectionsAt(2, headings, lines, end),
  };
}

export function firstText(lines: readonly Line[]): Line | undefined {
  return lines.find(({ text }) => text.trim() !== "");
}

export function marked(level: number, title: string): string {
  return `\`${"#".repeat(level)} ${title}\``;
}

export const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function ruleProblem(rule: HeadingRule, title: string): string | undefined {
  if (rule === "version") return VERSION.test(title) ? undefined : "is not a version such as 1.2.0";
  return undefined;
}

export function slotLabel(slot: Slot): string {
  return slot.type === "fixed" ? slot.text : slot.placeholder;
}

function fixedIndexOf(slots: readonly Slot[], title: string): number {
  return slots.findIndex((slot) => slot.type === "fixed" && (slot.text === title || (slot.also ?? []).includes(title)));
}

function openIndexFrom(slots: readonly Slot[], at: number): { readonly index: number; readonly advances: boolean } {
  const current = slots[at];
  if (current?.type === "open") return { index: at, advances: false };
  const ahead = slots.findIndex((slot, index) => index > at && slot.type === "open");
  if (ahead !== -1) return { index: ahead, advances: true };
  const behind = slots.findLastIndex((slot, index) => index < at && slot.type === "open");
  const reachable = slots[behind];
  return { index: reachable?.type === "open" && reachable.interleaved === true ? behind : -1, advances: false };
}

function missing(slot: Slot, level: number): string {
  return slot.type === "fixed" ? `lacks ${marked(level, slot.text)}` : `lacks a ${marked(level, slot.placeholder)} section`;
}

type Placement =
  | { readonly kind: "behind"; readonly index: number }
  | { readonly kind: "unplaced" }
  | { readonly kind: "placed"; readonly index: number; readonly slot: Slot; readonly at: number };

function placementOf(slots: readonly Slot[], title: string, at: number): Placement {
  const fixed = fixedIndexOf(slots, title);
  if (fixed !== -1 && fixed <= at) return { kind: "behind", index: fixed };
  const open = openIndexFrom(slots, at);
  const index = fixed !== -1 ? fixed : open.index;
  const slot = slots[index];
  if (slot === undefined) return { kind: "unplaced" };
  return { kind: "placed", index, slot, at: fixed !== -1 || open.advances ? index : at };
}

function placedProblems(slot: Slot, { heading, subsections }: Section, level: number): Violation[] {
  const problem = slot.type === "open" ? ruleProblem(slot.rule, heading.title) : undefined;
  return [
    ...(problem === undefined ? [] : [{ line: heading.line, message: `${marked(level, heading.title)} ${problem}` }]),
    ...(slot.subsections === undefined ? [] : matchSections(subsections, slot.subsections, level + 1, heading.line)),
  ];
}

export function matchSections(sections: readonly Section[], slots: readonly Slot[], level: number, parentLine: number): Violation[] {
  const order = `the template's order is ${slots.map(slotLabel).join(", ")}`;
  const violations: Violation[] = [];
  const found = slots.map(() => false);
  let at = -1;
  for (const section of sections) {
    const { heading } = section;
    const named = marked(level, heading.title);
    const placement = placementOf(slots, heading.title, at);
    if (placement.kind === "unplaced") {
      violations.push({ line: heading.line, message: `${named} is not a section the template has there, as ${order}` });
      continue;
    }
    found[placement.index] = true;
    if (placement.kind === "behind") {
      const problem = placement.index === at ? "appears twice" : `is out of order, as ${order}`;
      violations.push({ line: heading.line, message: `${named} ${problem}` });
      continue;
    }
    at = placement.at;
    violations.push(...placedProblems(placement.slot, section, level));
  }
  slots.forEach((slot, index) => {
    if (slot.presence.required && found[index] !== true) violations.push({ line: parentLine, message: missing(slot, level) });
  });
  return violations;
}

const BANNED_TITLES = new Set(["overview", "introduction", "how it works"]);

export function outlineProblems({ headings, lead }: Outline): Violation[] {
  const violations: Violation[] = [];
  const [first] = headings;
  if (first === undefined || first.level !== 1 || first.line !== 1) {
    violations.push({ line: 1, message: "does not open with a `# ` title on its first line" });
  }
  headings.forEach((heading, index) => {
    const named = marked(heading.level, heading.title);
    if (heading.level === 1 && index > 0) violations.push({ line: heading.line, message: `${named} is a second title` });
    const previous = headings[index - 1];
    if (previous !== undefined && heading.level > previous.level + 1) {
      violations.push({ line: heading.line, message: `${named} skips a level under ${marked(previous.level, previous.title)}` });
    }
    if (BANNED_TITLES.has(heading.title.toLowerCase())) {
      violations.push({ line: heading.line, message: `${named} names no topic; title it by what the reader does or looks up` });
    }
  });
  if (first?.level === 1 && firstText(lead) === undefined) {
    violations.push({ line: first.line, message: "has nothing between its title and its first section" });
  }
  return violations;
}
