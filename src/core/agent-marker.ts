export const AGENT_MARKER = "CHECKS_AGENT";
export const AI_AGENT_MARKER = "AI_AGENT";

export function isAgent(checksAgent: string | undefined, aiAgent: string | undefined): boolean {
  return checksAgent === "1" || (aiAgent !== undefined && aiAgent !== "");
}
