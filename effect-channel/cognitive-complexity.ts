import type { Context, CreateRule, ESTree } from "@oxlint/plugins";
import { cognitiveComplexity, type SelfNames } from "./cognitive.ts";

const DEFAULT_MAX = 15;

function maxOf(options: Context["options"]): number {
  const [first] = options;
  if (typeof first === "object" && first !== null && "max" in first && typeof first.max === "number" && first.max > 0) {
    return Math.floor(first.max);
  }
  return DEFAULT_MAX;
}

function keyName(holder: { readonly key: ESTree.PropertyKey; readonly computed: boolean }): string | undefined {
  if (holder.computed) return undefined;
  if (holder.key.type === "Identifier") return holder.key.name;
  if (holder.key.type === "Literal" && typeof holder.key.value === "string") return holder.key.value;
  return undefined;
}

type Binding = { readonly kind: keyof SelfNames; readonly name: string };

function assignedBinding(target: ESTree.Node): Binding | undefined {
  if (target.type === "Identifier") return { kind: "identifiers", name: target.name };
  if (target.type === "MemberExpression" && target.object.type === "ThisExpression" && target.property.type === "Identifier") {
    return { kind: "members", name: target.property.name };
  }
  return undefined;
}

function memberBinding(holder: { readonly key: ESTree.PropertyKey; readonly computed: boolean }): Binding | undefined {
  const name = keyName(holder);
  return name === undefined ? undefined : { kind: "members", name };
}

function binding(node: ESTree.Function | ESTree.ArrowFunctionExpression): Binding | undefined {
  const parent = node.parent;
  if (parent.type === "VariableDeclarator" && parent.init === node && parent.id.type === "Identifier") {
    return { kind: "identifiers", name: parent.id.name };
  }
  if (
    (parent.type === "Property" ||
      parent.type === "MethodDefinition" ||
      parent.type === "PropertyDefinition" ||
      parent.type === "AccessorProperty") &&
    parent.value === node
  ) {
    return memberBinding(parent);
  }
  if (parent.type === "AssignmentExpression" && parent.right === node) return assignedBinding(parent.left);
  return undefined;
}

function displayName(node: ESTree.Function | ESTree.ArrowFunctionExpression): string {
  if (node.type !== "ArrowFunctionExpression" && node.id !== null) return node.id.name;
  return binding(node)?.name ?? "anonymous";
}

function selfNames(node: ESTree.Function | ESTree.ArrowFunctionExpression): SelfNames {
  const own = node.type === "ArrowFunctionExpression" || node.id === null ? [] : [node.id.name];
  const bound = binding(node);
  return {
    identifiers: bound?.kind === "identifiers" ? [...own, bound.name] : own,
    members: bound?.kind === "members" ? [bound.name] : [],
  };
}

const NO_NAMES: SelfNames = { identifiers: [], members: [] };

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
      const score = node.type === "StaticBlock" ? cognitiveComplexity(node, NO_NAMES) : cognitiveComplexity(node, selfNames(node));
      if (score <= max) return;
      const name = node.type === "StaticBlock" ? "static block" : `function \`${displayName(node)}\``;
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
