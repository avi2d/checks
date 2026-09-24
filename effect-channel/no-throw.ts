import type { CreateRule } from "@oxlint/plugins";

const rule: CreateRule = {
  meta: {
    type: "problem",
    docs: { description: "Disallow throw, which fails outside Effect's error channel" },
  },
  create(context) {
    return {
      ThrowStatement(node) {
        context.report({
          node,
          message:
            "throw escapes the error channel: no type records the failure, so no caller has to answer for it. Define the failure with Schema.TaggedError and fail with it through Effect.fail, so it stays in E for Effect.catchTag to handle",
        });
      },
    };
  },
};

export default rule;
