import { Effect, Schema } from "effect";
import { HtmlElement, HtmlValidate, Rule, StaticConfigLoader, TextNode, staticResolver, type DOMReadyEvent, type Plugin } from "html-validate";
import { collecting, separatorFindings, type Collector, type CopyFinding, type Place } from "./copy-text.ts";

const PLUGIN = "copy";
const RULE = `${PLUGIN}/separators`;

const UNREAD: ReadonlySet<string> = new Set(["script", "style", "template", "pre"]);
const CODE: ReadonlySet<string> = new Set(["code", "kbd", "samp", "var"]);
const TEXT_ATTRIBUTES = ["alt", "title", "placeholder", "aria-label", "aria-description"] as const;
const BUTTON_TYPES: ReadonlySet<string> = new Set(["submit", "button", "reset"]);
const LABELLED: ReadonlySet<string> = new Set(["option", "optgroup"]);
const META_COPY: ReadonlySet<string> = new Set(["description", "og:title", "og:description", "twitter:title", "twitter:description"]);

// Code stands in as one character that is neither a letter nor a space, so a hyphen after it still reads as spaced.
const HIDDEN = "\0";

const NAMED: Readonly<Record<string, string>> = { mdash: "—", ndash: "–", nbsp: "\u00a0" };
const ENTITY = /^&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]{1,31}));/;
const LARGEST_CODE_POINT = 0x10ffff;

function decoded([, decimal, hex, name]: RegExpExecArray): string {
  const point = decimal === undefined ? (hex === undefined ? undefined : Number.parseInt(hex, 16)) : Number(decimal);
  if (point === undefined) return NAMED[name ?? ""] ?? HIDDEN;
  return point > 0 && point <= LARGEST_CODE_POINT ? String.fromCodePoint(point) : HIDDEN;
}

function addSource(collector: Collector, source: string, from: Place): void {
  let { line, column } = from;
  let at = 0;
  while (at < source.length) {
    const entity = source.charAt(at) === "&" ? ENTITY.exec(source.slice(at)) : null;
    const char = entity === null ? source.charAt(at) : decoded(entity);
    const length = entity === null ? 1 : entity[0].length;
    collector.add(char, { line, column });
    if (char === "\n") {
      line += 1;
      column = 1;
    } else column += length;
    at += length;
  }
}

function addAttribute(element: HtmlElement, key: string, attributes: Collector): void {
  const attribute = element.getAttribute(key);
  if (attribute === null || typeof attribute.value !== "string" || attribute.valueLocation === null) return;
  addSource(attributes, attribute.value, attribute.valueLocation);
  attributes.end();
}

function readAttributes(element: HtmlElement, attributes: Collector): void {
  for (const key of TEXT_ATTRIBUTES) addAttribute(element, key, attributes);
  const named = element.getAttributeValue("name") ?? element.getAttributeValue("property");
  if (element.tagName === "meta" && named !== null && META_COPY.has(named)) addAttribute(element, "content", attributes);
  const type = element.getAttributeValue("type")?.toLowerCase();
  if (element.tagName === "input" && type !== undefined && BUTTON_TYPES.has(type)) addAttribute(element, "value", attributes);
  if (LABELLED.has(element.tagName)) addAttribute(element, "label", attributes);
}

function readElement(element: HtmlElement, text: Collector, attributes: Collector): void {
  readAttributes(element, attributes);
  const inline = element.meta?.phrasing === true && element.tagName !== "br";
  if (!inline) text.end();
  if (CODE.has(element.tagName)) text.add(HIDDEN, element.location);
  else if (!UNREAD.has(element.tagName)) readChildren(element, text, attributes);
  if (!inline) text.end();
}

function readChildren(element: HtmlElement, text: Collector, attributes: Collector): void {
  for (const child of element.childNodes) {
    if (child instanceof TextNode) addSource(text, child.textContent, child.location);
    else if (child instanceof HtmlElement) readElement(child, text, attributes);
  }
}

class Separators extends Rule {
  override setup(): void {
    this.on("dom:ready", ({ document, source }: DOMReadyEvent) => {
      const text = collecting();
      const attributes = collecting();
      readChildren(document.root, text, attributes);
      for (const { line, column, message } of separatorFindings([...text.blocks(), ...attributes.blocks()])) {
        this.report(null, message, { filename: source.filename, line, column, offset: 0, size: 1 });
      }
    });
  }
}

const plugin: Plugin = { name: PLUGIN, rules: { [RULE]: Separators } };

const validator = new HtmlValidate(
  new StaticConfigLoader([staticResolver({ plugins: { [PLUGIN]: plugin } })], {
    root: true,
    elements: ["html5", { svg: { foreign: false }, math: { foreign: false } }],
    plugins: [PLUGIN],
    rules: { [RULE]: "error" },
  }),
);

class CopyHtmlError extends Schema.TaggedError<CopyHtmlError>()("CopyHtmlError", { message: Schema.String }) {}

export const htmlFindings = Effect.fn("htmlFindings")(function* (source: string, file: string) {
  const { results } = yield* Effect.tryPromise({
    try: () => validator.validateString(source, file),
    catch: (cause) => new CopyHtmlError({ message: `html-validate cannot read ${file}: ${String(cause)}` }),
  });
  return results.flatMap(({ messages }) =>
    messages.map(({ line, column, message, ruleId }) => ({ line, column, message: ruleId === RULE ? message : `does not parse as HTML: ${message}` })),
  ) satisfies readonly CopyFinding[];
});
