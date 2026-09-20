import type { Plugin } from "@oxlint/plugins";
import noErrorChannelEscape from "./no-error-channel-escape.ts";

const plugin: Plugin = {
  meta: { name: "effect-channel" },
  rules: { "no-error-channel-escape": noErrorChannelEscape },
};

export default plugin;
