import type { CreateRule, ESTree } from "@oxlint/plugins";

function unwrapped(expression: ESTree.Expression): ESTree.Expression {
  let current = expression;
  while (
    current.type === "TSAsExpression" ||
    current.type === "TSSatisfiesExpression" ||
    current.type === "TSNonNullExpression" ||
    current.type === "TSTypeAssertion"
  ) {
    current = current.expression;
  }
  return current;
}

function isAstroProps(value: ESTree.Expression): boolean {
  if (value.type !== "MemberExpression" || value.computed) return false;
  const { object, property } = value;
  return (
    object.type === "Identifier" &&
    object.name === "Astro" &&
    property.type === "Identifier" &&
    property.name === "props"
  );
}

function readsProps(expression: ESTree.Expression, bound: ReadonlySet<string>): boolean {
  const value = unwrapped(expression);
  if (value.type === "MemberExpression") return isAstroProps(value) || readsProps(value.object, bound);
  return value.type === "Identifier" && bound.has(value.name);
}

function boundName(pattern: ESTree.BindingPattern | ESTree.BindingRestElement | null, found: Set<string>): void {
  if (pattern === null) return;
  if (pattern.type === "RestElement") boundName(pattern.argument, found);
  else if (pattern.type === "AssignmentPattern") boundName(pattern.left, found);
  else if (pattern.type === "ObjectPattern") {
    for (const property of pattern.properties) boundName(property.type === "Property" ? property.value : property.argument, found);
  } else if (pattern.type === "ArrayPattern") {
    for (const element of pattern.elements) boundName(element, found);
  } else found.add(pattern.name);
}

function isTypeDeclaration(statement: ESTree.Statement): boolean {
  const declaration = statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
  return declaration?.type === "TSInterfaceDeclaration" || declaration?.type === "TSTypeAliasDeclaration";
}

const rule: CreateRule = {
  meta: {
    type: "problem",
    docs: { description: "Disallow logic in .astro frontmatter: only imports, props and markup" },
  },
  create(context) {
    if (!context.filename.endsWith(".astro")) return {};
    const bound = new Set<string>();
    return {
      Program(node) {
        for (const statement of node.body) {
          if (
            statement.type === "ImportDeclaration" ||
            statement.type === "EmptyStatement" ||
            (statement.type === "ExportNamedDeclaration" && statement.source !== null) ||
            isTypeDeclaration(statement)
          ) {
            continue;
          }
          if (
            statement.type === "VariableDeclaration" &&
            statement.declarations.length > 0 &&
            statement.declarations.every(
              (declarator) => declarator.init !== null && readsProps(declarator.init, bound),
            )
          ) {
            for (const declarator of statement.declarations) boundName(declarator.id, bound);
            continue;
          }
          context.report({
            node: statement,
            message:
              "frontmatter holds more than imports and props: move this statement into a .ts file and import it, so the .astro file holds only imports, props and markup",
          });
        }
      },
    };
  },
};

export default rule;
