import { AGENT_MARKER } from "../core/agent-marker.ts";

if (process.env[AGENT_MARKER] === "1" && process.env.CI !== "true") {
  const { guardLocalTests } = await import("../core/local-tests.ts");
  await guardLocalTests().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
