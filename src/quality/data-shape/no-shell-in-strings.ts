import type { CreateRule, ESTree } from "@oxlint/plugins";

type Line = { readonly node: ESTree.Node; readonly text: string };

const LEAST_SHELL_LINES = 5;

const SHELL_MARKS: readonly RegExp[] = [
  /^#!\/(?:usr\/)?bin\/(?:env\s+)?(?:ba|da|z)?sh\b/u,
  /^(?:if|elif|while|until)\s+(?!\()/u,
  /^(?:then|fi|do|done|esac)\s*(?:;|$)/u,
  /^case\s.+\sin$/u,
  /;\s*(?:then|do)$/u,
  /;;/u,
  /(?<![\w$])\$\((?!["'`])/u,
  /"\$@"/u,
  /\$\{[A-Za-z_]\w*[:#%/}]/u,
  /&&|\|\|/u,
  /^(?:trap|exec)\s/u,
];

const JAVASCRIPT_MARKS = /\b(?:const|let|var|function|await|import|export|typeof|new)\s|=>|===|!==|\bconsole\.|[{(]$|^[)}]|(?<!;);$/u;

function readsAsShell(text: string): boolean {
  const line = text.trim();
  return SHELL_MARKS.some((mark) => mark.test(line)) && !JAVASCRIPT_MARKS.test(line);
}

function split(node: ESTree.Node, text: string): readonly Line[] {
  return text.split("\n").map((line) => ({ node, text: line }));
}

function joined(parts: readonly (ESTree.Node | null)[]): readonly Line[] | undefined {
  const found = parts.flatMap((part) => (part === null || part.type === "SpreadElement" ? [] : [textLines(part)]));
  const lines = found.filter((one) => one !== undefined);
  return lines.length === 0 ? undefined : lines.flat();
}

function textLines(node: ESTree.Node): readonly Line[] | undefined {
  if (node.type === "Literal") return typeof node.value === "string" ? split(node, node.value) : undefined;
  if (node.type === "TemplateLiteral") return split(node, node.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join(""));
  if (node.type === "ArrayExpression") return joined(node.elements);
  if (node.type === "BinaryExpression" && node.operator === "+") return joined([node.left, node.right]);
  return undefined;
}

function insideLargerString(node: ESTree.Node): boolean {
  const { parent } = node;
  return parent?.type === "ArrayExpression" || (parent?.type === "BinaryExpression" && parent.operator === "+");
}

const rule: CreateRule = {
  meta: {
    type: "suggestion",
    docs: { description: "Refuse a shell program written as TypeScript strings, which no linter of either language reads" },
  },
  create(context) {
    const check = (node: ESTree.Node): void => {
      if (insideLargerString(node)) return;
      const shell = (textLines(node) ?? []).filter((line) => readsAsShell(line.text));
      const [first] = shell;
      if (first === undefined || shell.length < LEAST_SHELL_LINES) return;
      context.report({
        node: first.node,
        message: `These strings hold ${shell.length} lines that read as shell, the first \`${first.text.trim()}\`. Move the program to a .sh file the code runs, where a shell linter reads it.`,
      });
    };
    return { Literal: check, TemplateLiteral: check, ArrayExpression: check, BinaryExpression: check };
  },
};

export default rule;
