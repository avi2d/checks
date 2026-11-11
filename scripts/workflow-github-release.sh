set -eo pipefail
entries="$(gh api --paginate "repos/${GITHUB_REPOSITORY}/releases?per_page=100" --jq '.[] | [.tag_name, (.id | tostring)] | @tsv')"
releases="$(printf '%s\n' "$entries" | cut -f1)"
highest="$(printf '%s\n%s\n' "$releases" "$GITHUB_REF_NAME" | bun -e 'const tags = (await new Response(Bun.stdin).text()).trim().split(/\s+/).filter((tag) => /^v\d+\.\d+\.\d+(?:[-+].*)?$/.test(tag)); const versions = tags.map((tag) => tag.slice(1)); const highest = versions.reduce((best, version) => Bun.semver.order(version, best) === 1 ? version : best); process.stdout.write(`v${highest}`)')"
release_id="$(printf '%s\n' "$entries" | awk -F '\t' -v tag="$GITHUB_REF_NAME" '$1 == tag { print $2; exit }')"
make_latest=false
if [ "$highest" = "$GITHUB_REF_NAME" ]; then make_latest=true; fi
jq -n --arg tag "$GITHUB_REF_NAME" --arg name "$GITHUB_REF_NAME" --arg latest "$make_latest" --rawfile body "$RUNNER_TEMP/release-notes.md" '{tag_name: $tag, name: $name, body: $body, draft: false, prerelease: false, make_latest: $latest}' > "$RUNNER_TEMP/release.json"
if [ -n "$release_id" ]; then
  gh api --method PATCH "repos/${GITHUB_REPOSITORY}/releases/$release_id" --input "$RUNNER_TEMP/release.json" --jq '.id'
else
  gh api --method POST "repos/${GITHUB_REPOSITORY}/releases" --input "$RUNNER_TEMP/release.json" --jq '.id'
fi
