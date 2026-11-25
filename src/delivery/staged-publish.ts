import { Effect } from "effect";

export function stagedShasum(stderr: string, version: string): string | undefined {
  if (!stderr.includes("npm error code E409") || !stderr.includes(`Cannot publish over previously staged version "${version}"`)) return undefined;
  return stderr.match(/^npm notice shasum:\s*([a-f0-9]{40})\s*$/m)?.[1];
}

export const awaitStagedVersion = Effect.fn("awaitStagedVersion")(function* <E, R>(
  shasum: string,
  read: () => Effect.Effect<string | undefined, E, R>,
  wait: () => Effect.Effect<void>,
  attempts: number,
) {
  for (let index = 0; index < attempts; index += 1) {
    const found = yield* read();
    if (found !== undefined) return found === shasum;
    if (index + 1 < attempts) yield* wait();
  }
  return false;
});
