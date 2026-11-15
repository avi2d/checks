export function settingsFile(settings: Readonly<Record<string, unknown>>): string {
  return `export default ${JSON.stringify(settings, undefined, 2)};\n`;
}
