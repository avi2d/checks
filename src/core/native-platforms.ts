import manifest from "../../package.json";

export type PlatformTarget = { readonly os: string; readonly cpu: string; readonly libc?: string };

export const nativePlatforms = [
  { os: "darwin", cpu: "arm64" },
  { os: "linux", cpu: "x64", libc: "glibc" },
] as const satisfies readonly PlatformTarget[];

export type NativePlatform = (typeof nativePlatforms)[number];

export const nativePlatform = nativePlatforms.find(({ os, cpu }) => os === process.platform && cpu === process.arch);

export const assetNameOf = (binary: string, { os, cpu }: PlatformTarget): string => `${binary}-${os}-${cpu}`;
export const platformPackageOf = (mainPackage: string, { os, cpu }: PlatformTarget): string => `${mainPackage}-${os}-${cpu}`;
export const packagedBinaryOf = (binary: string, version: string): string => `${binary}-${version}`;

const KIT_BINARY = "checks";
export const assetName = (platform: NativePlatform): string => assetNameOf(KIT_BINARY, platform);
export const platformPackage = (platform: NativePlatform): string => platformPackageOf(manifest.name, platform);
export const platformBinary = packagedBinaryOf(KIT_BINARY, manifest.version);
