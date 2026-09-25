import type { Context, CreateRule, ESTree, Node as OxlintNode } from "@oxlint/plugins";
import { cognitiveComplexity } from "./cognitive.ts";

const DEFAULT_MAX = 15;

function isNode(value: unknown): value is ESTree.Node {
  return typeof value === "object" && value !== null && "type" in value && typeof value.type === "string";
}

function ancestorsOf(context: Context, node: OxlintNode): readonly ESTree.Node[] {
  return context.sourceCode.getAncestors(node).filter(isNode);
}

function maxOf(options: Context["options"]): number {
  const [first] = options;
  if (typeof first === "object" && first !== null && "max" in first && typeof first.max === "number" && first.max > 0) {
    return Math.floor(first.max);
  }
  return DEFAULT_MAX;
}

function keyName(key: ESTree.PropertyKey): string | undefined {
  if (key.type === "Identifier") return key.name;
  if (key.type === "Literal" && typeof key.value === "string") return key.value;
  return undefined;
}

function declaratorName(ancestors: readonly ESTree.Node[]): string | undefined {
  const declarator = ancestors.findLast((ancestor) => ancestor.type === "VariableDeclarator");
  if (declarator !== undefined && declarator.id.type === "Identifier") {
    return declarator.id.name;
  }
  return undefined;
}

function memberName(ancestors: readonly ESTree.Node[]): string | undefined {
  const holder = ancestors.findLast((ancestor) => ancestor.type === "Property" || ancestor.type === "MethodDefinition");
  if (holder !== undefined && (holder.type === "Property" || holder.type === "MethodDefinition")) return keyName(holder.key);
  return undefined;
}

function assignmentName(ancestors: readonly ESTree.Node[]): string | undefined {
  const assignment = ancestors.findLast((ancestor) => ancestor.type === "AssignmentExpression");
  if (assignment === undefined) return undefined;
  if (assignment.left.type === "Identifier") return assignment.left.name;
  if (
    assignment.left.type === "MemberExpression" &&
    assignment.left.object.type === "ThisExpression" &&
    assignment.left.property.type === "Identifier"
  ) {
    return assignment.left.property.name;
  }
  return undefined;
}

function displayName(node: ESTree.Function | ESTree.ArrowFunctionExpression, ancestors: readonly ESTree.Node[]): string {
  if (node.type !== "ArrowFunctionExpression" && node.id !== null) return node.id.name;
  return declaratorName(ancestors) ?? memberName(ancestors) ?? assignmentName(ancestors) ?? "anonymous";
}

function recursionNames(node: ESTree.Function | ESTree.ArrowFunctionExpression, ancestors: readonly ESTree.Node[]): readonly string[] {
  const own = node.type === "ArrowFunctionExpression" ? undefined : node.id?.name;
  const bound = declaratorName(ancestors) ?? memberName(ancestors) ?? assignmentName(ancestors);
  const names: readonly (string | undefined)[] = [own, bound];
  return names.filter((name): name is string => name !== undefined);
}

const rule: CreateRule = {
  meta: {
    type: "problem",
    docs: { description: "Hold each function to a cognitive complexity of 15" },
    schema: [{ type: "object", properties: { max: { type: "number" } }, additionalProperties: false }],
    defaultOptions: [{ max: DEFAULT_MAX }],
  },
  create(context) {
    const max = maxOf(context.options);

    const check = (node: ESTree.Function | ESTree.ArrowFunctionExpression | ESTree.StaticBlock): void => {
      const ancestors = ancestorsOf(context, node);
      const score =
        node.type === "StaticBlock"
          ? cognitiveComplexity(node, [])
          : cognitiveComplexity(node, recursionNames(node, ancestors));
      if (score <= max) return;
      const name = node.type === "StaticBlock" ? "static block" : `function \`${displayName(node, ancestors)}\``;
      context.report({ node, message: `${name} has a cognitive complexity of ${score}. Maximum allowed is ${max}.` });
    };

    return {
      FunctionDeclaration: check,
      FunctionExpression: check,
      ArrowFunctionExpression: check,
      StaticBlock: check,
    };
  },
};

export default rule;
