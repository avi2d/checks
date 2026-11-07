export const MANIFEST = "package.json";

export const TAG_PREFIX = "v";

export const RELEASE_TAG_GLOB = `${TAG_PREFIX}[0-9]*.[0-9]*.[0-9]*`;

export function releaseTag(version: string): string {
  return `${TAG_PREFIX}${version}`;
}

// The tag starts with TAG_PREFIX.
export function taggedVersion(tag: string): string {
  return tag.slice(TAG_PREFIX.length);
}
