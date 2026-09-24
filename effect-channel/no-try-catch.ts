import type { CreateRule } from "@oxlint/plugins";

const rule: CreateRule = {
  meta: {
    type: "problem",
    docs: { description: "Disallow a try statement with a catch clause, which recovers outside Effect's error channel" },
  },
  create(context) {
    return {
      CatchClause(node) {
        context.report({
          node,
          message:
            "catch recovers outside the error channel: it takes whatever was thrown as unknown, bugs included. Wrap the throwing call in Effect.try or Effect.tryPromise, whose catch maps the cause to a Schema.TaggedError, and recover by tag with Effect.catchTag",
        });
      },
    };
  },
};

export default rule;
