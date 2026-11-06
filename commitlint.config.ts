// subject-case cannot be relaxed for one author, so every rule skips the title shapes Dependabot writes.
const subject = String.raw`(?:[Bb]ump|[Uu]pdate) \S.*`;
const dependabot = new RegExp(String.raw`^(?:build|chore)\(deps(?:-dev)?\): ${subject}$`);

export default {
  extends: ["@commitlint/config-conventional"],
  ignores: [(message: string) => dependabot.test(message)],
};
