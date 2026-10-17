import { bodyOf, carries, continues, scanMarkdown, SEPARATORS, type LineKind } from "./prose-matchers.ts";

export type Place = { readonly line: number; readonly column: number };

export type CopyFinding = Place & { readonly message: string };

// Each place is the source position of the character at the same index in text.
type Block = { readonly text: string; readonly places: readonly Place[] };

export type Collector = {
  readonly add: (char: string, place: Place) => void;
  readonly end: () => void;
  readonly blocks: () => readonly Block[];
};

const SPACE = /\s/;

// A reader sees each run of white space as one space, so a hyphen wrapped onto the next line still reads as spaced.
export function collecting(): Collector {
  const done: Block[] = [];
  let text = "";
  let places: Place[] = [];
  const add = (char: string, place: Place): void => {
    const spaced = SPACE.test(char);
    if (spaced && (text === "" || text.endsWith(" "))) return;
    text += spaced ? " " : char;
    places.push(place);
  };
  const end = (): void => {
    if (text.trim() !== "") done.push({ text, places });
    text = "";
    places = [];
  };
  return {
    add,
    end,
    blocks: () => {
      end();
      return done;
    },
  };
}

function blockFindings({ text, places }: Block): readonly CopyFinding[] {
  return SEPARATORS.flatMap((rule) =>
    [...text.matchAll(rule.find)].flatMap((match) => {
      const place = places[match.index + match[0].length - match[0].trimStart().length];
      return place === undefined ? [] : [{ ...place, message: carries(match[0], rule) }];
    }),
  );
}

export function separatorFindings(blocks: readonly Block[]): readonly CopyFinding[] {
  return blocks.flatMap(blockFindings).toSorted((a, b) => a.line - b.line || a.column - b.column);
}

const READ_KINDS: ReadonlySet<LineKind> = new Set(["prose", "heading", "table", "html"]);

export function markdownFindings(text: string): readonly CopyFinding[] {
  const lines = scanMarkdown(text);
  const collector = collecting();
  for (const [index, line] of lines.entries()) {
    if (!continues(lines[index - 1], line)) collector.end();
    if (!READ_KINDS.has(line.kind)) continue;
    const body = bodyOf(line);
    for (let at = 0; at < body.length; at += 1) collector.add(body.charAt(at), { line: line.line, column: at + 1 });
    collector.add("\n", { line: line.line, column: body.length + 1 });
  }
  return separatorFindings(collector.blocks());
}
