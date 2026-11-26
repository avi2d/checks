import type { CreateRule, ESTree } from "@oxlint/plugins";

const EFFECT_BARREL = "effect";
const EFFECT_MODULE = "effect/Effect";

const DIAGNOSTIC = {
  drops:
    "erases the error channel: it drops the failure and the success together, so no caller can tell one from the other. Handle the error by tag, or keep it as a value with Effect.result or Effect.exit",
  swallows:
    "erases the error channel: a Cause is the typed error plus defects plus interruption, so this swallows the bugs and the cancellations along with it. Catch the errors you named, with Effect.catchTag or Effect.catchTags",
  filtered:
    "can recover from a Cause that includes defects or interruptions. A non-match still fails. To handle only typed errors, use Effect.catchIf or Effect.catchFilter",
  blind:
    "erases the error channel: the handler cannot see what it is recovering from, so every error in the channel collapses into one fallback. Name the errors with Effect.catchTag, or take the error and use it",
} as const;

const REFUSED = new Map<string, string>([
  ["ignore", DIAGNOSTIC.drops],
  ["ignoreCause", DIAGNOSTIC.drops],
  ["catchCause", DIAGNOSTIC.swallows],
  ["catchCauseIf", DIAGNOSTIC.filtered],
  ["catchCauseFilter", DIAGNOSTIC.filtered],
]);

const BLIND_RECOVERY = new Set(["catch", "catchEager", "orElseSucceed"]);

const blindToTheError = (handler: ESTree.Node | undefined): boolean => {
  if (!handler) return false;
  if (handler.type !== "ArrowFunctionExpression" && handler.type !== "FunctionExpression") return false;
  return handler.params.every((param) => param.type === "Identifier" && /^_+$/.test(param.name));
};

function propertyName(node: ESTree.MemberExpression | ESTree.Property): string | undefined {
  const property = node.type === "MemberExpression" ? node.property : node.key;
  if (!node.computed && property.type === "Identifier") return property.name;
  if (property.type === "Literal" && typeof property.value === "string") return property.value;
  if (property.type === "TemplateLiteral" && property.expressions.length === 0) return property.quasis[0]?.value.cooked ?? undefined;
  return undefined;
}

type EffectBinding = { readonly kind: "module" } | { readonly kind: "combinator"; readonly name: string };

function effectBinding(source: string, specifier: ESTree.ImportDeclaration["specifiers"][number]): EffectBinding | undefined {
  if (specifier.type !== "ImportSpecifier") return source === EFFECT_MODULE ? { kind: "module" } : undefined;
  if (specifier.importKind === "type") return undefined;
  const name = specifier.imported.type === "Identifier" ? specifier.imported.name : specifier.imported.value;
  if (source === EFFECT_BARREL) return name === "Effect" ? { kind: "module" } : undefined;
  if (BLIND_RECOVERY.has(name) || REFUSED.has(name)) return { kind: "combinator", name };
  return undefined;
}

const rule: CreateRule = {
  meta: {
    type: "problem",
    docs: { description: "Disallow the combinators that erase Effect's error channel" },
  },
  create(context) {
    function checkReference(node: ESTree.Node, combinator: string): void {
      const call = node.parent;
      const blindRecovery = BLIND_RECOVERY.has(combinator) && call?.type === "CallExpression" && call.callee === node && blindToTheError(call.arguments.at(-1));
      const diagnostic = blindRecovery ? DIAGNOSTIC.blind : REFUSED.get(combinator);
      if (diagnostic !== undefined) {
        context.report({ node: blindRecovery ? call : node, message: `Effect.${combinator} ${diagnostic}` });
      }
    }

    function checkModuleReference(identifier: ESTree.Node): void {
      const parent = identifier.parent;
      if (parent?.type === "MemberExpression" && parent.object === identifier) {
        const combinator = propertyName(parent);
        if (combinator !== undefined) checkReference(parent, combinator);
        return;
      }
      if (parent?.type !== "VariableDeclarator" || parent.init !== identifier || parent.parent?.type !== "VariableDeclaration" || parent.parent.kind !== "const") return;
      if (parent.id.type === "Identifier") {
        checkBinding(parent, parent.id, { kind: "module" });
        return;
      }
      if (parent.id.type !== "ObjectPattern") return;
      for (const property of parent.id.properties) {
        if (property.type !== "Property" || property.value.type !== "Identifier") continue;
        const name = propertyName(property);
        if (name !== undefined && (REFUSED.has(name) || BLIND_RECOVERY.has(name))) {
          checkBinding(parent, property.value, { kind: "combinator", name });
        }
      }
    }

    function checkBinding(declaration: ESTree.Node, identifier: ESTree.Identifier, binding: EffectBinding): void {
      for (const variable of context.sourceCode.getDeclaredVariables(declaration)) {
        if (variable.name !== identifier.name) continue;
        for (const reference of variable.references) {
          if (!reference.isRead() || reference.identifier.parent?.type === "TSTypeQuery" || reference.identifier.parent?.type === "TSQualifiedName") continue;
          if (binding.kind === "module") checkModuleReference(reference.identifier);
          else checkReference(reference.identifier, binding.name);
        }
      }
    }

    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (node.importKind === "type" || (source !== EFFECT_BARREL && source !== EFFECT_MODULE)) return;
        for (const specifier of node.specifiers) {
          const binding = effectBinding(source, specifier);
          if (binding !== undefined) checkBinding(specifier, specifier.local, binding);
        }
      },
    };
  },
};

export default rule;
