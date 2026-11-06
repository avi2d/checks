// subject-case cannot be relaxed for one author, so every rule skips the title shapes Dependabot writes.
const token = String.raw`\S*[^\s.]`;
const directory = String.raw`in \/\S*[^\s.]`;
const group = String.raw`[\w.-]+`;
const single = String.raw`[Bb]ump ${token} from ${token} to ${token}(?: ${directory})?`;
const bumpTo = String.raw`[Bb]ump ${token} to ${token}`;
const joint = String.raw`[Bb]ump ${token}(?:, ${token})* and ${token}`;
const byName = String.raw`[Bb]ump ${token}(?: ${directory}| across \d+ director(?:y|ies))`;
const requirementVersion = String.raw`(?:[~^<>=!]+ )?${token}(?:, (?:[~^<>=!]+ )?${token})*`;
const requirement = String.raw`[Uu]pdate ${token} requirement (?:from ${requirementVersion} )?to ${requirementVersion}`;
const inGroup = String.raw`[Bb]ump ${token} from ${token} to ${token} in the ${group} group(?: across \d+ director(?:y|ies))?`;
const groupWithUpdates = String.raw`[Bb]ump the ${group} group(?: ${directory}| across \d+ director(?:y|ies))? with \d+ updates?`;
const dependabot = new RegExp(
  String.raw`^build\(deps(?:-dev)?\): (?:${single}|${bumpTo}|${joint}|${byName}|${requirement}|${inGroup}|${groupWithUpdates})(?: \(#\d+\))?$`,
);

export default {
  extends: ["@commitlint/config-conventional"],
  ignores: [(message: string) => dependabot.test(message)],
};
