export function fullRunRefusal(args: readonly string[], ci: string): string | undefined;

export function missingReportRefusal(
  args: readonly string[],
  ci: string,
  incrementalFile: string,
  reportExists?: (path: string) => boolean,
): string | undefined;
