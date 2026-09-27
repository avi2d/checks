type Identifier = { readonly type: "Identifier"; readonly name: string };
type Literal = { readonly type: "Literal" };
type ThisMarker = { readonly type: "ThisExpression" | "Super" | "MetaProperty" };
export type If = { readonly type: "IfStatement"; readonly test: SyntaxNode; readonly consequent: SyntaxNode; readonly alternate: SyntaxNode | null };
type Conditional = {
  readonly type: "ConditionalExpression";
  readonly test: SyntaxNode;
  readonly consequent: SyntaxNode;
  readonly alternate: SyntaxNode;
};
type Switch = { readonly type: "SwitchStatement"; readonly discriminant: SyntaxNode; readonly cases: readonly SyntaxNode[] };
type SwitchCase = { readonly type: "SwitchCase"; readonly test: SyntaxNode | null; readonly consequent: readonly SyntaxNode[] };
type For = {
  readonly type: "ForStatement";
  readonly init: SyntaxNode | null;
  readonly test: SyntaxNode | null;
  readonly update: SyntaxNode | null;
  readonly body: SyntaxNode;
};
type ForEach = {
  readonly type: "ForInStatement" | "ForOfStatement";
  readonly left: SyntaxNode;
  readonly right: SyntaxNode;
  readonly body: SyntaxNode;
};
type While = { readonly type: "WhileStatement"; readonly test: SyntaxNode; readonly body: SyntaxNode };
type DoWhile = { readonly type: "DoWhileStatement"; readonly body: SyntaxNode; readonly test: SyntaxNode };
type Try = { readonly type: "TryStatement"; readonly block: SyntaxNode; readonly handler: SyntaxNode | null; readonly finalizer: SyntaxNode | null };
type Catch = { readonly type: "CatchClause"; readonly param: SyntaxNode | null; readonly body: SyntaxNode };
type Logical = { readonly type: "LogicalExpression"; readonly left: SyntaxNode; readonly operator: string; readonly right: SyntaxNode };
type Jump = { readonly type: "BreakStatement" | "ContinueStatement"; readonly label: SyntaxNode | null };
type Call = { readonly type: "CallExpression" | "NewExpression"; readonly callee: SyntaxNode; readonly arguments: readonly SyntaxNode[] };
type ImportCall = { readonly type: "ImportExpression"; readonly source: SyntaxNode; readonly options: SyntaxNode | null };
export type NamedFunction = {
  readonly type: "FunctionDeclaration" | "FunctionExpression" | "TSDeclareFunction" | "TSEmptyBodyFunctionExpression";
  readonly id: SyntaxNode | null;
  readonly params: readonly SyntaxNode[];
  readonly body: SyntaxNode | null;
};
export type Arrow = { readonly type: "ArrowFunctionExpression"; readonly params: readonly SyntaxNode[]; readonly body: SyntaxNode };
export type Static = { readonly type: "StaticBlock"; readonly body: readonly SyntaxNode[] };
type Labeled = { readonly type: "LabeledStatement"; readonly body: SyntaxNode };
type Block = { readonly type: "BlockStatement"; readonly body: readonly SyntaxNode[] };
type ExpressionStatement = { readonly type: "ExpressionStatement"; readonly expression: SyntaxNode };
type Return = { readonly type: "ReturnStatement" | "ThrowStatement"; readonly argument: SyntaxNode | null };
type VariableDeclaration = { readonly type: "VariableDeclaration"; readonly declarations: readonly SyntaxNode[] };
type VariableDeclarator = { readonly type: "VariableDeclarator"; readonly id: SyntaxNode; readonly init: SyntaxNode | null };
type AssignmentPattern = { readonly type: "AssignmentPattern"; readonly left: SyntaxNode; readonly right: SyntaxNode };
type ObjectPattern = { readonly type: "ObjectPattern"; readonly properties: readonly SyntaxNode[] };
type ArrayPattern = { readonly type: "ArrayPattern"; readonly elements: readonly (SyntaxNode | null)[] };
type Property = { readonly type: "Property"; readonly key: SyntaxNode; readonly value: SyntaxNode };
type Rest = { readonly type: "RestElement"; readonly argument: SyntaxNode };
type ParameterProperty = { readonly type: "TSParameterProperty"; readonly parameter: SyntaxNode };
type Class = {
  readonly type: "ClassDeclaration" | "ClassExpression";
  readonly decorators: readonly SyntaxNode[];
  readonly id: SyntaxNode | null;
  readonly superClass: SyntaxNode | null;
  readonly body: SyntaxNode;
};
type ClassBody = { readonly type: "ClassBody"; readonly body: readonly SyntaxNode[] };
type Method = { readonly type: "MethodDefinition" | "TSAbstractMethodDefinition"; readonly key: SyntaxNode; readonly value: SyntaxNode };
type Field = {
  readonly type: "PropertyDefinition" | "TSAbstractPropertyDefinition" | "AccessorProperty" | "TSAbstractAccessorProperty";
  readonly key: SyntaxNode;
  readonly value: SyntaxNode | null;
};
type ObjectLiteral = { readonly type: "ObjectExpression"; readonly properties: readonly SyntaxNode[] };
type ArrayLiteral = { readonly type: "ArrayExpression"; readonly elements: readonly (SyntaxNode | null)[] };
type UnaryLike = {
  readonly type: "AwaitExpression" | "UnaryExpression" | "UpdateExpression" | "SpreadElement";
  readonly argument: SyntaxNode;
};
type Yield = { readonly type: "YieldExpression"; readonly argument: SyntaxNode | null };
type Binary = { readonly type: "BinaryExpression"; readonly left: SyntaxNode; readonly right: SyntaxNode };
type Assign = { readonly type: "AssignmentExpression"; readonly left: SyntaxNode; readonly right: SyntaxNode };
type Wrap = {
  readonly type:
    | "TSAsExpression"
    | "TSSatisfiesExpression"
    | "TSTypeAssertion"
    | "TSNonNullExpression"
    | "ChainExpression"
    | "ParenthesizedExpression"
    | "Decorator"
    | "TSInstantiationExpression";
  readonly expression: SyntaxNode;
};
type Member = { readonly type: "MemberExpression" | "JSXMemberExpression"; readonly object: SyntaxNode; readonly property: SyntaxNode };
type Template = { readonly type: "TemplateLiteral"; readonly expressions: readonly SyntaxNode[] };
type Tagged = { readonly type: "TaggedTemplateExpression"; readonly tag: SyntaxNode; readonly quasi: SyntaxNode };
type Sequence = { readonly type: "SequenceExpression"; readonly expressions: readonly SyntaxNode[] };
type With = { readonly type: "WithStatement"; readonly object: SyntaxNode; readonly body: SyntaxNode };
type JSXElement = { readonly type: "JSXElement"; readonly openingElement: SyntaxNode; readonly children: readonly SyntaxNode[] };
type JSXFragment = { readonly type: "JSXFragment"; readonly children: readonly SyntaxNode[] };
type JSXOpening = { readonly type: "JSXOpeningElement"; readonly attributes: readonly SyntaxNode[] };
type JSXAttribute = { readonly type: "JSXAttribute"; readonly value: SyntaxNode | null };
type JSXExpression = { readonly type: "JSXExpressionContainer" | "JSXSpreadChild"; readonly expression: SyntaxNode };
type JSXSpread = { readonly type: "JSXSpreadAttribute"; readonly argument: SyntaxNode };
type EnumDeclaration = { readonly type: "TSEnumDeclaration"; readonly body: SyntaxNode };
type EnumBody = { readonly type: "TSEnumBody"; readonly members: readonly SyntaxNode[] };
type EnumMember = { readonly type: "TSEnumMember"; readonly initializer: SyntaxNode | null };
type Leaves = {
  readonly type:
    | "Hashbang"
    | "EmptyStatement"
    | "DebuggerStatement"
    | "TemplateElement"
    | "PrivateIdentifier"
    | "ImportDeclaration"
    | "ImportSpecifier"
    | "ImportDefaultSpecifier"
    | "ImportNamespaceSpecifier"
    | "ImportAttribute"
    | "ExportNamedDeclaration"
    | "ExportDefaultDeclaration"
    | "ExportAllDeclaration"
    | "ExportSpecifier"
    | "TSExportAssignment"
    | "TSNamespaceExportDeclaration"
    | "TSImportEqualsDeclaration"
    | "TSExternalModuleReference"
    | "TSInterfaceDeclaration"
    | "TSInterfaceBody"
    | "TSPropertySignature"
    | "TSIndexSignature"
    | "TSCallSignatureDeclaration"
    | "TSMethodSignature"
    | "TSConstructSignatureDeclaration"
    | "TSInterfaceHeritage"
    | "TSTypeAnnotation"
    | "TSTypeAliasDeclaration"
    | "TSEnumMemberName"
    | "TSLiteralType"
    | "TSUnionType"
    | "TSIntersectionType"
    | "TSParenthesizedType"
    | "TSTypeOperator"
    | "TSArrayType"
    | "TSIndexedAccessType"
    | "TSTupleType"
    | "TSNamedTupleMember"
    | "TSOptionalType"
    | "TSRestType"
    | "TSAnyKeyword"
    | "TSStringKeyword"
    | "TSBooleanKeyword"
    | "TSNumberKeyword"
    | "TSNeverKeyword"
    | "TSIntrinsicKeyword"
    | "TSUnknownKeyword"
    | "TSNullKeyword"
    | "TSUndefinedKeyword"
    | "TSVoidKeyword"
    | "TSSymbolKeyword"
    | "TSThisType"
    | "TSObjectKeyword"
    | "TSBigIntKeyword"
    | "TSTypeReference"
    | "TSQualifiedName"
    | "TSTypeParameter"
    | "TSTypeParameterDeclaration"
    | "TSTypeParameterInstantiation"
    | "TSClassImplements"
    | "TSFunctionType"
    | "TSConstructorType"
    | "TSMappedType"
    | "TSInferType"
    | "TSTypeQuery"
    | "TSImportType"
    | "TSImportTypeQualifiedName"
    | "TSTypePredicate"
    | "TSTemplateLiteralType"
    | "TSJSDocNullableType"
    | "TSJSDocNonNullableType"
    | "TSJSDocUnknownType"
    | "TSModuleDeclaration"
    | "TSModuleBlock"
    | "TSTypeLiteral"
    | "TSConditionalType"
    | "V8IntrinsicExpression"
    | "JSXText"
    | "JSXIdentifier"
    | "JSXNamespacedName"
    | "JSXOpeningFragment"
    | "JSXClosingElement"
    | "JSXClosingFragment"
    | "JSXEmptyExpression";
};

export type SyntaxNode =
  | Identifier
  | Literal
  | ThisMarker
  | If
  | Conditional
  | Switch
  | SwitchCase
  | For
  | ForEach
  | While
  | DoWhile
  | Try
  | Catch
  | Logical
  | Jump
  | Call
  | ImportCall
  | NamedFunction
  | Arrow
  | Static
  | Labeled
  | Block
  | ExpressionStatement
  | Return
  | VariableDeclaration
  | VariableDeclarator
  | AssignmentPattern
  | ObjectPattern
  | ArrayPattern
  | Property
  | Rest
  | ParameterProperty
  | Class
  | ClassBody
  | Method
  | Field
  | ObjectLiteral
  | ArrayLiteral
  | UnaryLike
  | Yield
  | Binary
  | Assign
  | Wrap
  | Member
  | Template
  | Tagged
  | Sequence
  | With
  | JSXElement
  | JSXFragment
  | JSXOpening
  | JSXAttribute
  | JSXExpression
  | JSXSpread
  | EnumDeclaration
  | EnumBody
  | EnumMember
  | Leaves;

export type Control = If | Conditional | Switch | SwitchCase | Try | Catch;
export type Loop = For | ForEach | While | DoWhile | Labeled;
export type CallLike = Logical | Jump | Call | ImportCall;
export type FunctionKind = NamedFunction | Arrow | Static;
export type PlainA =
  | Block
  | ExpressionStatement
  | Return
  | VariableDeclaration
  | VariableDeclarator
  | AssignmentPattern
  | ObjectPattern
  | ArrayPattern
  | Property
  | Rest
  | ParameterProperty
  | With
  | EnumDeclaration
  | EnumBody
  | EnumMember;
export type PlainB = Class | ClassBody | Method | Field | ObjectLiteral | ArrayLiteral;
export type PlainC =
  | UnaryLike
  | Yield
  | Binary
  | Assign
  | Wrap
  | Member
  | Template
  | Tagged
  | Sequence
  | JSXElement
  | JSXFragment
  | JSXOpening
  | JSXAttribute
  | JSXExpression
  | JSXSpread;

export const CONTROL_TYPES: readonly string[] = ["IfStatement", "ConditionalExpression", "SwitchStatement", "SwitchCase", "TryStatement", "CatchClause"];

export const LOOP_TYPES: readonly string[] = ["ForStatement", "ForInStatement", "ForOfStatement", "WhileStatement", "DoWhileStatement", "LabeledStatement"];
export const CALL_TYPES: readonly string[] = ["LogicalExpression", "BreakStatement", "ContinueStatement", "CallExpression", "NewExpression", "ImportExpression"];
export const FUNCTION_TYPES: readonly string[] = ["FunctionDeclaration", "FunctionExpression", "TSDeclareFunction", "TSEmptyBodyFunctionExpression", "ArrowFunctionExpression", "StaticBlock"];
export const PLAIN_A_TYPES: readonly string[] = ["BlockStatement", "ExpressionStatement", "ReturnStatement", "ThrowStatement", "VariableDeclaration", "VariableDeclarator", "AssignmentPattern", "ObjectPattern", "ArrayPattern", "Property", "RestElement", "TSParameterProperty", "WithStatement", "TSEnumDeclaration", "TSEnumBody", "TSEnumMember"];
export const PLAIN_B_TYPES: readonly string[] = ["ClassDeclaration", "ClassExpression", "ClassBody", "MethodDefinition", "TSAbstractMethodDefinition", "PropertyDefinition", "TSAbstractPropertyDefinition", "AccessorProperty", "TSAbstractAccessorProperty", "ObjectExpression", "ArrayExpression"];
export const PLAIN_C_TYPES: readonly string[] = ["AwaitExpression", "UnaryExpression", "UpdateExpression", "SpreadElement", "YieldExpression", "BinaryExpression", "AssignmentExpression", "TSAsExpression", "TSSatisfiesExpression", "TSTypeAssertion", "TSNonNullExpression", "ChainExpression", "ParenthesizedExpression", "Decorator", "TSInstantiationExpression", "MemberExpression", "JSXMemberExpression", "TemplateLiteral", "TaggedTemplateExpression", "SequenceExpression", "JSXElement", "JSXFragment", "JSXOpeningElement", "JSXAttribute", "JSXExpressionContainer", "JSXSpreadChild", "JSXSpreadAttribute"];
