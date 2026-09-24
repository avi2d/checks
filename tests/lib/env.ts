// The suite runs in a pull request on CI, whose event would otherwise decide checks-lint's range.
export function withoutPullRequestEvent(): Record<string, string | undefined> {
  const { GITHUB_EVENT_NAME: _name, GITHUB_EVENT_PATH: _path, ...env } = process.env;
  return env;
}
