const PR = "--pr";

export type BrowserArgs = { readonly pr: boolean; readonly directory: string };

export function browserArgs(args: readonly string[]): BrowserArgs | undefined {
  const pr = args.filter((arg) => arg === PR).length;
  const rest = args.filter((arg) => arg !== PR);
  if (pr > 1 || rest.length > 1 || rest.some((arg) => arg.startsWith("--"))) return undefined;
  return { pr: pr === 1, directory: rest[0] ?? "." };
}
