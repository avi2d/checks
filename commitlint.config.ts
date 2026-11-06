// subject-case cannot be relaxed for one author, so every rule skips the title shapes Dependabot writes.
const token = String.raw`\S*[^\s.]`;
const directory = String.raw`in \/\S*[^\s.]`;
const single = String.raw`[Bb]ump ${token} from ${token} to ${token}(?: ${directory})?`;
const grouped = String.raw`[Bb]ump the [\w.-]+ group(?: (?:${directory}|across \d+ (?:directory|directories)))? with \d+ updates?`;
const dependabot = new RegExp(String.raw`^build\(deps(?:-dev)?\): (?:${single}|${grouped})(?: \(#\d+\))?$`);

export default {
  extends: ["@commitlint/config-conventional"],
  ignores: [(message: string) => dependabot.test(message)],
};
