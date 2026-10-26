// The suite runs in a pull request on CI, whose event would otherwise decide checks-lint's range and default branch.
export function withoutPullRequestEvent(): Record<string, string | undefined> {
  const { GITHUB_EVENT_NAME: _name, GITHUB_EVENT_PATH: _path, GITHUB_BASE_REF: _base, ...env } = process.env;
  return env;
}
