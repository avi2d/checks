export const MANIFEST = "package.json";

export const TAG_PREFIX = "v";

export const RELEASE_TAG_GLOB = `${TAG_PREFIX}[0-9]*.[0-9]*.[0-9]*`;

export function releaseTag(version: string): string {
  return `${TAG_PREFIX}${version}`;
}

const RELEASE_SUBJECT = /^chore: release (\d+\.\d+\.\d+)(?: \(#\d+\))?$/;

export function releasedVersionOf(subject: string): string | undefined {
  return RELEASE_SUBJECT.exec(subject)?.[1];
}

// The tag starts with TAG_PREFIX.
export function taggedVersion(tag: string): string {
  return tag.slice(TAG_PREFIX.length);
}
