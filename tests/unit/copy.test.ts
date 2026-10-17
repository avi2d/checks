import { expect, test } from "bun:test";
import { Effect } from "effect";
import { htmlFindings } from "../../src/docs/copy-html.ts";
import { markdownFindings } from "../../src/docs/copy-text.ts";
import { passes, report, type Scan } from "../../src/docs/copy.ts";

const HYPHEN = "carries `-`, a hyphen used as a dash. End the sentence, or use a comma";
const EM_DASH = "carries `—`, an em dash. End the sentence, or use a comma";
const EN_DASH = "carries `–`, an en dash. End the sentence, or use a comma";

const REPORTED = "- [hexn.io](https://hexn.io/ru) - платформа криптовалютной торговли и\n  сбережений\n";
const FIXED = "- [hexn.io](https://hexn.io/ru), платформа криптовалютной торговли и\n  сбережений\n";
const RENDERED = '<p><a href="https://hexn.io/ru">hexn.io</a> - платформа криптовалютной торговли и сбережений</p>\n';

const html = (source: string) => Effect.runPromise(htmlFindings(source, "dist/index.html"));

test("the hexn.io line from the website's home page fails as a hyphen used as a dash in its source and its built page, and its comma form passes", async () => {
  expect(markdownFindings(REPORTED)).toEqual([{ line: 1, column: 33, message: HYPHEN }]);
  expect(markdownFindings(FIXED)).toEqual([]);
  expect(await html(RENDERED)).toEqual([{ line: 1, column: 45, message: HYPHEN }]);
  expect(await html(RENDERED.replace("</a> -", "</a>,"))).toEqual([]);
});

test("an em dash and an en dash fail in Russian and English copy", () => {
  expect(markdownFindings("Блог — новости и прогнозы.\n\nPages 1–5 hold it.\n")).toEqual([
    { line: 1, column: 6, message: EM_DASH },
    { line: 3, column: 8, message: EN_DASH },
  ]);
});

test("a hyphen inside a word or a number, a flag, a list marker and code all pass", () => {
  const passing = [
    "A well-known, kebab-case name covers pages 1-5.",
    "Run it with --flag set.",
    "- a list item\n- another",
    "Run `a - b` in a shell.",
    "```\na - b\n```",
    "| a | - | b |",
    "See [the page](https://example.com/a - b).",
  ];
  expect(passing.flatMap((text) => markdownFindings(`${text}\n`))).toEqual([]);
});

test("a hyphen that ends one line of a paragraph and meets a word on the next reads as spaced", () => {
  expect(markdownFindings("It builds -\nand ships.\n")).toEqual([{ line: 1, column: 11, message: HYPHEN }]);
  expect(markdownFindings("It builds\n\n- and ships.\n")).toEqual([]);
});

test("a page's title, its meta description and its alt text are copy, with each dash entity decoded", async () => {
  const page = [
    "<!doctype html>",
    '<html lang="en"><head><title>Home &mdash; Example</title>',
    '<meta name="description" content="Notes - and more">',
    '<meta property="og:title" content="One &#8211; two"></head>',
    '<body><img src="a.png" alt="A cat&nbsp;- asleep"></body></html>',
  ].join("\n");
  expect(await html(page)).toEqual([
    { line: 2, column: 35, message: EM_DASH },
    { line: 3, column: 41, message: HYPHEN },
    { line: 4, column: 40, message: EN_DASH },
    { line: 5, column: 40, message: HYPHEN },
  ]);
});

test("code stands in as text, while script, style, a template and preformatted text are not read", async () => {
  expect(await html("<p>Pass <code>--flag</code> - it sets the mode.</p>")).toEqual([{ line: 1, column: 29, message: HYPHEN }]);
  expect(await html("<script>a - b</script><style>a::after { content: '—'; }</style><template><p>a - b</p></template><pre>a - b</pre>")).toEqual([]);
});

test("a textarea, noscript, SVG text and MathML text are copy a visitor reads", async () => {
  expect(await html("<textarea>hexn.io - платформа</textarea>")).toEqual([{ line: 1, column: 19, message: HYPHEN }]);
  expect(await html("<noscript><p>hexn.io - платформа</p></noscript>")).toEqual([{ line: 1, column: 22, message: HYPHEN }]);
  expect(await html("<svg><text>hexn.io - платформа</text></svg>")).toEqual([{ line: 1, column: 20, message: HYPHEN }]);
  expect(await html("<math><mtext>hexn.io - платформа</mtext></math>")).toEqual([{ line: 1, column: 22, message: HYPHEN }]);
});

test("text breaks at a block and at a line break, so a hyphen that opens one passes", async () => {
  expect(await html("<ul><li>Coffee</li><li>- milk</li></ul><p>Coffee<br>- milk</p><p>Coffee</p>- milk")).toEqual([]);
  expect(await html("<p>Coffee <strong>-</strong> milk</p>")).toEqual([{ line: 1, column: 19, message: HYPHEN }]);
});

test("a page that does not parse as HTML is reported, since nothing in it can be judged", async () => {
  const [found] = await html('<p class=">copy</p>');
  expect(found?.message).toStartWith("does not parse as HTML: ");
});

const CLEAN: Scan = {
  inputs: [
    { glob: "src/content/**/*.md", files: ["src/content/home.md"] },
    { glob: "**/*.md", files: ["README.md", "src/content/home.md"] },
  ],
  unread: [],
  violations: [],
};

test("a clean scan passes and counts each file once across overlapping inputs", () => {
  expect(passes(CLEAN)).toBe(true);
  expect(report(CLEAN)).toBe("copy: no violation in 2 file(s) from 2 declared input(s)");
});

test("an empty input and a file of another kind each fail beside each violation", () => {
  const scan: Scan = {
    inputs: [...CLEAN.inputs, { glob: "dist/**/*.html", files: [] }],
    unread: ["src/content/home.ts"],
    violations: [{ file: "src/content/home.md", line: 26, column: 33, text: HYPHEN }],
  };
  expect(passes(scan)).toBe(false);
  expect(report(scan)).toBe(
    [
      "copy: 3 problem(s) in 2 file(s) from 3 declared input(s):",
      "  dist/**/*.html: the declared input matches no Markdown or HTML file",
      "  src/content/home.ts: is neither Markdown nor HTML, so the gate cannot read it",
      `  src/content/home.md:26:33 ${HYPHEN}`,
    ].join("\n"),
  );
  expect(passes({ ...CLEAN, unread: ["a.txt"] })).toBe(false);
  expect(passes({ ...CLEAN, inputs: [{ glob: "dist/**/*.html", files: [] }] })).toBe(false);
});
