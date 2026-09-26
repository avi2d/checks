import type { Plugin } from "@oxlint/plugins";
import noErrorChannelEscape from "./no-error-channel-escape.ts";
import noThrow from "./no-throw.ts";
import noTryCatch from "./no-try-catch.ts";

const plugin: Plugin = {
  meta: { name: "effect-channel" },
  rules: {
    "no-error-channel-escape": noErrorChannelEscape,
    "no-throw": noThrow,
    "no-try-catch": noTryCatch,
  },
};

export default plugin;
