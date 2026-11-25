import manifest from "../../package.json";

export const nativePlatforms = [
  { os: "darwin", cpu: "arm64" },
  { os: "linux", cpu: "x64" },
] as const;

export type NativePlatform = (typeof nativePlatforms)[number];

export const nativePlatform = nativePlatforms.find(({ os, cpu }) => os === process.platform && cpu === process.arch);

export const assetName = ({ os, cpu }: NativePlatform): string => `checks-${os}-${cpu}`;
export const platformPackage = (platform: NativePlatform): string => `${manifest.name}-${platform.os}-${platform.cpu}`;
export const platformBinary = `checks-${manifest.version}`;
