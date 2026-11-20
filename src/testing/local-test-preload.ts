import { AGENT_MARKER, AI_AGENT_MARKER, isAgent } from "../core/agent-marker.ts";

if (process.env.CI !== "true" && isAgent(process.env[AGENT_MARKER], process.env[AI_AGENT_MARKER])) {
  const { AgentTestsBlocked, guardLocalTests } = await import("../core/local-tests.ts");
  const { UNDECIDED, VIOLATED } = await import("../core/main.ts");
  await guardLocalTests().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(error instanceof AgentTestsBlocked ? VIOLATED : UNDECIDED);
  });
}
