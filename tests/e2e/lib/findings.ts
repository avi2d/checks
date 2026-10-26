export function findings(output: string, pattern: RegExp): ReadonlyMap<string, readonly string[]> {
  const found = new Map<string, string[]>();
  for (const [, file = "", rule = ""] of output.matchAll(pattern)) found.set(file, [...(found.get(file) ?? []), rule]);
  return found;
}
