# Changelog

Every release of `@avi2dg/checks`, newest first, written by the release from its conventional commits.

## 0.119.0

Released 2026-11-26.

### Features

- **core:** print per-gate wall time in checks-lint [#233](https://github.com/avi2d/checks/pull/233)

## 0.118.0

Released 2026-11-26.

### Features

- **delivery:** add platformPackages option to checks-workflows for npm binaries [#231](https://github.com/avi2d/checks/pull/231)
- **delivery:** publish compiled checks binaries to npm as platform packages [#229](https://github.com/avi2d/checks/pull/229)
- compile gates to Bun AOT bytecode binaries and attach them to releases [#228](https://github.com/avi2d/checks/pull/228)

### Fixes

- narrow test runs for reach map changes [#227](https://github.com/avi2d/checks/pull/227)
- **delivery:** treat npm publish refusals without an error code as already published [#224](https://github.com/avi2d/checks/pull/224)

### Performance

- **quality:** share the visit page with the axe audit in checks-browser [#226](https://github.com/avi2d/checks/pull/226)

## 0.117.2

Released 2026-11-25.

### Fixes

- **delivery:** publish each release version once and stay green when it is already on npm [#222](https://github.com/avi2d/checks/pull/222)

## 0.117.1

Released 2026-11-25.

### Fixes

- **browser:** compare keyboard focus screenshots in Bun instead of the page [#220](https://github.com/avi2d/checks/pull/220)

## 0.117.0

Released 2026-11-25.

### Breaking changes

- **quality:** refuse reduce accumulator copies; orc, skills, dotfiles fix on upgrade [#217](https://github.com/avi2d/checks/pull/217)

### Features

- **delivery:** attach compiled release assets to GitHub releases [#218](https://github.com/avi2d/checks/pull/218)

## 0.116.0

Released 2026-11-24.

### Features

- **delivery:** support optional release version input [#214](https://github.com/avi2d/checks/pull/214)
- **release-pr:** allow explicit maintenance versions [#213](https://github.com/avi2d/checks/pull/213)
- size test and browser workers from runner cores [#212](https://github.com/avi2d/checks/pull/212)
- **delivery:** list ci and test commits as Maintenance with no listed changes [#211](https://github.com/avi2d/checks/pull/211)

## 0.115.0

Released 2026-11-23.

### Features

- **ci:** run affected tests on pull requests [#207](https://github.com/avi2d/checks/pull/207)

### Fixes

- **browser:** pass the element path reader to Playwright as a function [#209](https://github.com/avi2d/checks/pull/209)

## 0.114.0

Released 2026-11-23.

### Features

- **browser:** split checks across timing-balanced shards [#206](https://github.com/avi2d/checks/pull/206)
- **browser:** print check timings per route [#202](https://github.com/avi2d/checks/pull/202)

### Fixes

- **browser:** exclude blur paint from keyboard focus checks [#205](https://github.com/avi2d/checks/pull/205)
- **delivery:** allow TS extension imports in fresh setup tsconfig [#204](https://github.com/avi2d/checks/pull/204)
- **browser:** scope PR routes through importing pages [#203](https://github.com/avi2d/checks/pull/203)

## 0.113.0

Released 2026-11-23.

### Features

- **delivery:** split CI test jobs into unit and e2e tiers [#192](https://github.com/avi2d/checks/pull/192)
- **delivery:** run docs builds on pull requests [#194](https://github.com/avi2d/checks/pull/194)
- **testing:** add test file exclusions and cap file time at two minutes [#193](https://github.com/avi2d/checks/pull/193)

### Fixes

- **delivery:** read release refs through GitHub API [#200](https://github.com/avi2d/checks/pull/200)
- **testing:** kill site browsers after tests [#199](https://github.com/avi2d/checks/pull/199)
- **browser:** measure keyboard focus rings within their paint bounds [#198](https://github.com/avi2d/checks/pull/198)
- **delivery:** keep setup dependency order stable [#197](https://github.com/avi2d/checks/pull/197)

## 0.112.0

Released 2026-11-21.

### Features

- **delivery:** refuse commands.test so tests run only in CI [#186](https://github.com/avi2d/checks/pull/186)

### Fixes

- **delivery:** select workflow runners by repository visibility [#191](https://github.com/avi2d/checks/pull/191)
- **delivery:** build before retrying a release publish [#190](https://github.com/avi2d/checks/pull/190)
- **docs:** require a vision page in every kit repository [#189](https://github.com/avi2d/checks/pull/189)

## 0.111.1

Released 2026-11-21.

### Fixes

- **delivery:** run the release test step as one checks-ci command [#185](https://github.com/avi2d/checks/pull/185)

## 0.111.0

Released 2026-11-21.

### Breaking changes

- use agentTests.allowLocal for local agent tests [#181](https://github.com/avi2d/checks/pull/181)

### Features

- **delivery:** write full workflow files and refuse shared workflow callers [#182](https://github.com/avi2d/checks/pull/182)

### Fixes

- **delivery:** print release help early and gate non-default branch releases [#183](https://github.com/avi2d/checks/pull/183)

## 0.110.0

Released 2026-11-20.

### Features

- **testing:** fail CI when a test file exceeds five minutes [#176](https://github.com/avi2d/checks/pull/176)

### Fixes

- allow empty repositories through test and repetition gates [#179](https://github.com/avi2d/checks/pull/179)
- **browser:** share one loaded page for target discovery and nesting [#177](https://github.com/avi2d/checks/pull/177)
- **delivery:** update pinned GitHub Actions to current majors [#174](https://github.com/avi2d/checks/pull/174)
- **delivery:** an unset ATTEMPTS reads as one try in commit-status [#175](https://github.com/avi2d/checks/pull/175)

## 0.109.0

Released 2026-11-18.

### Features

- **delivery:** ship checks-ci commands and full workflow files [#171](https://github.com/avi2d/checks/pull/171)
- **delivery:** support v3.4.0 release callers and workspace publishing [#170](https://github.com/avi2d/checks/pull/170)

## 0.108.0

Released 2026-11-17.

### Features

- **testing:** block agent local test runs behind localTests switch [#168](https://github.com/avi2d/checks/pull/168)

## 0.107.0

Released 2026-11-17.

### Features

- **browser:** scope pull request checks to reached routes [#166](https://github.com/avi2d/checks/pull/166)

## 0.106.1

Released 2026-11-17.

### Fixes

- **browser:** wait until no entrance starts before settle returns [#164](https://github.com/avi2d/checks/pull/164)

## 0.106.0

Released 2026-11-16.

### Features

- **delivery:** keep optional callers and read release rule from changes [#162](https://github.com/avi2d/checks/pull/162)

## 0.105.0

Released 2026-11-16.

### Features

- split lint into source and built stages and skip release pull request jobs [#160](https://github.com/avi2d/checks/pull/160)

## 0.104.0

Released 2026-11-16.

### Features

- move kit-owned settings into checks.config.ts [#158](https://github.com/avi2d/checks/pull/158)

## 0.103.0

Released 2026-11-15.

### Features

- **delivery:** compose ci.yml from CI parts and keep caller test jobs [#156](https://github.com/avi2d/checks/pull/156)

## 0.102.0

Released 2026-11-15.

### Features

- **delivery:** tell a site by its callers and pass the site names as inputs [#154](https://github.com/avi2d/checks/pull/154)

## 0.101.2

Released 2026-11-15.

### Fixes

- **delivery:** pass shared v3 workflow secrets by name instead of inherit [#152](https://github.com/avi2d/checks/pull/152)

## 0.101.1

Released 2026-11-15.

### Fixes

- **delivery:** align shared caller permissions and concurrency with v3 jobs [#150](https://github.com/avi2d/checks/pull/150)

## 0.101.0

Released 2026-11-15.

### Features

- **delivery:** enforce shared workflow callers with single release and production gate [#147](https://github.com/avi2d/checks/pull/147)
- **testing:** narrow pull request runs by the site's reach map [#146](https://github.com/avi2d/checks/pull/146)
- **browser:** pick the anchor screen set on pull requests [#145](https://github.com/avi2d/checks/pull/145)

### Fixes

- **delivery:** pin shared callers at v3 and start ci when a draft is ready [#148](https://github.com/avi2d/checks/pull/148)

## 0.100.0

Released 2026-11-14.

### Features

- **browser:** run gate cells four at a time [#143](https://github.com/avi2d/checks/pull/143)

## 0.99.0

Released 2026-11-14.

### Features

- **browser:** judge visible text by role and page tokens [#140](https://github.com/avi2d/checks/pull/140)

### Fixes

- **browser:** read axe after entrance animations settle [#141](https://github.com/avi2d/checks/pull/141)

## 0.98.1

Released 2026-11-14.

### Fixes

- **browser:** report only text that a clipping box cuts [#138](https://github.com/avi2d/checks/pull/138)

## 0.98.0

Released 2026-11-14.

### Features

- **core:** publish shared Bun, Chrome, command, and test helpers [#136](https://github.com/avi2d/checks/pull/136)
- **quality:** require type values from tokens outside token files [#135](https://github.com/avi2d/checks/pull/135)

## 0.97.0

Released 2026-11-13.

### Features

- **browser:** visit every built page and run chosen checks per state [#132](https://github.com/avi2d/checks/pull/132)

## 0.96.3

Released 2026-11-13.

### Fixes

- **ci:** start mutation by hand, not on pull requests [#131](https://github.com/avi2d/checks/pull/131)

## 0.96.2

Released 2026-11-13.

### Fixes

- **browser:** count pseudo element focus rings as visible focus [#129](https://github.com/avi2d/checks/pull/129)

## 0.96.1

Released 2026-11-13.

### Fixes

- **browser:** judge keyboard reach and focus the way a visitor meets the page [#127](https://github.com/avi2d/checks/pull/127)

## 0.96.0

Released 2026-11-13.

### Features

- **browser:** judge page weight budgets and cold load layout shift [#124](https://github.com/avi2d/checks/pull/124)
- **browser:** measure text contrast over photos and gradients [#123](https://github.com/avi2d/checks/pull/123)
- **browser:** widen assets check to console errors, uncaught errors and other origins [#122](https://github.com/avi2d/checks/pull/122)
- **browser:** add links check for same site targets and fragments [#121](https://github.com/avi2d/checks/pull/121)
- **browser:** add an html check to checks-browser [#118](https://github.com/avi2d/checks/pull/118)

### Fixes

- **testing:** let Stryker deadlines end the dry run, not the runner [#125](https://github.com/avi2d/checks/pull/125)

## 0.95.1

Released 2026-11-12.

### Fixes

- **browser:** list unpicturable focus as finding instead of ending run [#119](https://github.com/avi2d/checks/pull/119)

## 0.95.0

Released 2026-11-12.

### Features

- **delivery:** run plain-steps with no opt-in switch [#116](https://github.com/avi2d/checks/pull/116)

## 0.94.0

Released 2026-11-12.

### Features

- **delivery:** simplify mutation caller to shared v2 workflow [#114](https://github.com/avi2d/checks/pull/114)
- **quality:** add data-shape/no-shell-in-strings rule, off by default [#111](https://github.com/avi2d/checks/pull/111)

### Fixes

- **testing:** stop baseline refresh warning when mutation scope has no report [#110](https://github.com/avi2d/checks/pull/110)

## 0.93.0

Released 2026-11-11.

### Features

- **testing:** add HANDHELDS set of six phones and tablets [#105](https://github.com/avi2d/checks/pull/105)
- **testing:** serve a built site to browser tests [#103](https://github.com/avi2d/checks/pull/103)
- **delivery:** let plain-steps pass a step that runs the caller's command [#104](https://github.com/avi2d/checks/pull/104)

## 0.92.0

Released 2026-11-10.

### Features

- **testing:** standardize test scripts and size workers from free memory [#101](https://github.com/avi2d/checks/pull/101)
- **delivery:** add checks-plain-steps gate that refuses multi-command run steps [#100](https://github.com/avi2d/checks/pull/100)

## 0.91.0

Released 2026-11-09.

### Features

- **delivery:** release on demand through a release pull request [#97](https://github.com/avi2d/checks/pull/97)

### Fixes

- **delivery:** accept Dependabot only on GitHub-signed commits and skip its secrets pack [#98](https://github.com/avi2d/checks/pull/98)

## 0.90.0

Released 2026-11-08.

### Features

- **docs:** move vision page to root VISION.md with stance shape and repeat check [#93](https://github.com/avi2d/checks/pull/93)

## 0.89.0

Released 2026-11-08.

### Features

- **docs:** add a vision doc kind and require docs/vision.md [#92](https://github.com/avi2d/checks/pull/92)

## 0.88.0

Released 2026-11-08.

### Features

- **delivery:** hold no-mistakes test command to touched-only runs [#89](https://github.com/avi2d/checks/pull/89)

## 0.87.0

Released 2026-11-08.

### Features

- **docs:** name the governing records on a change and keep a generated record index [#87](https://github.com/avi2d/checks/pull/87)

## 0.86.2

Released 2026-11-08.

### Fixes

- **lint-coverage:** accept the macos shell wording for a missing oxlint [#90](https://github.com/avi2d/checks/pull/90)

## 0.86.1

Released 2026-11-08.

### Fixes

- **ci-wiring:** accept a scheduled call of the shared advisories workflow [#88](https://github.com/avi2d/checks/pull/88)

## 0.86.0

Released 2026-11-08.

### Features

- **dependencies:** file the advisories --all verdict as a GitHub issue with --issue [#84](https://github.com/avi2d/checks/pull/84)

## 0.85.0

Released 2026-11-08.

### Features

- **setup:** run typecheck and test in the generated ci workflow after a failed lint [#83](https://github.com/avi2d/checks/pull/83)

## 0.84.0

Released 2026-11-08.

### Features

- **testing:** refuse full, e2e and pixel checks-test runs outside CI [#81](https://github.com/avi2d/checks/pull/81)

## 0.83.0

Released 2026-11-08.

### Features

- **setup:** write the shared mutation caller and refuse a hand-rolled mutation job [#82](https://github.com/avi2d/checks/pull/82)
- **testing:** run only the tests a local change reaches with checks-test --changed [#80](https://github.com/avi2d/checks/pull/80)

## 0.82.0

Released 2026-11-08.

### Features

- **testing:** merge sharded mutation reports into one report [#79](https://github.com/avi2d/checks/pull/79)

## 0.81.0

Released 2026-11-08.

### Features

- **docs:** require governs on ADRs and refuse deleting governed paths [#76](https://github.com/avi2d/checks/pull/76)

## 0.80.0

Released 2026-11-08.

### Features

- **testing:** split whole-tree mutation runs into balanced shards [#78](https://github.com/avi2d/checks/pull/78)

## 0.79.0

Released 2026-11-08.

### Features

- **mutation:** use all cores on hosted runners and ignore static mutants in refresh [#75](https://github.com/avi2d/checks/pull/75)

## 0.78.1

Released 2026-11-08.

### Fixes

- **dependencies:** retry pinned downloads and cache gitleaks per platform [#77](https://github.com/avi2d/checks/pull/77)

## 0.78.0

Released 2026-11-08.

### Features

- **complexity:** refuse TypeScript heads with no .jscpd.json [#73](https://github.com/avi2d/checks/pull/73)

## 0.77.0

Released 2026-11-07.

### Features

- **quality:** refuse relative imports into other packages and node_modules [#72](https://github.com/avi2d/checks/pull/72)

## 0.76.0

Released 2026-11-07.

### Features

- **oxlint:** run schema-twin on tests too [#68](https://github.com/avi2d/checks/pull/68)

## 0.75.0

Released 2026-11-07.

### Features

- **delivery:** publish gitleaks and cache-root subpaths [#71](https://github.com/avi2d/checks/pull/71)

## 0.74.1

Released 2026-11-07.

### Fixes

- **core:** run the four whole-tree gates on every pull request again [#70](https://github.com/avi2d/checks/pull/70)

## 0.74.0

Released 2026-11-07.

### Features

- **quality:** refuse folder-level import cycles in the dependency-cruiser preset [#69](https://github.com/avi2d/checks/pull/69)

## 0.73.0

Released 2026-11-07.

### Features

- **testing:** run unit tier plus touched e2e files with checks-test --changed [#61](https://github.com/avi2d/checks/pull/61)

## 0.72.0

Released 2026-11-07.

### Features

- **checks-setup:** write root AGENTS.md and CLAUDE.md when absent [#60](https://github.com/avi2d/checks/pull/60)

## 0.71.0

Released 2026-11-07.

### Features

- rename night run to whole-tree run [#59](https://github.com/avi2d/checks/pull/59)

## 0.70.0

Released 2026-11-07.

### Features

- **docs:** require root AGENTS.md and CLAUDE.md with package.json [#58](https://github.com/avi2d/checks/pull/58)

## 0.69.0

Released 2026-11-06.

### Features

- export git, main, test and test-report helpers [#57](https://github.com/avi2d/checks/pull/57)

## 0.68.2

Released 2026-11-06.

### Fixes

- **commit-identity:** accept Dependabot bot identity on Dependabot titles [#53](https://github.com/avi2d/checks/pull/53)

## 0.68.1

Released 2026-11-06.

### Fixes

- **commitlint:** accept Dependabot titles that open with Bump or Update [#50](https://github.com/avi2d/checks/pull/50)

## 0.68.0

Released 2026-11-06.

### Features

- **ci-wiring:** accept short shared refs for runner pick and setup [#49](https://github.com/avi2d/checks/pull/49)

## 0.67.0

Released 2026-11-06.

### Features

- **ci-wiring:** accept shared runner pick and setup action [#48](https://github.com/avi2d/checks/pull/48)

## 0.66.0

Released 2026-11-05.

### Features

- **docs:** cap READMEs at 6,000 characters and table cells at 300 [#46](https://github.com/avi2d/checks/pull/46)

## 0.65.3

Released 2026-11-04.

### Fixes

- **ci-wiring:** require the night run step in TypeScript repositories [#45](https://github.com/avi2d/checks/pull/45)

## 0.65.2

Released 2026-11-04.

### Fixes

- **testing:** stop filing failed issues for fully undecided night runs [#43](https://github.com/avi2d/checks/pull/43)

## 0.65.1

Released 2026-11-03.

### Fixes

- allow weekly advisory scan in any public repository [#42](https://github.com/avi2d/checks/pull/42)

## 0.65.0

Released 2026-11-03.

### Features

- **ci-wiring:** one CI run per pull request, refuse schedules and long jobs [#41](https://github.com/avi2d/checks/pull/41)

## 0.64.0

Released 2026-11-03.

### Features

- **testing:** shard the night mutation run and file each missing report [#27](https://github.com/avi2d/checks/pull/27)

## 0.63.1

Released 2026-11-03.

### Fixes

- **testing:** note a cleared mutation issue once [#29](https://github.com/avi2d/checks/pull/29)

## 0.63.0

Released 2026-11-03.

### Features

- **testing:** close cleared test and gate issues and note cleared mutation issues [#28](https://github.com/avi2d/checks/pull/28)

## 0.62.1

Released 2026-11-02.

### Fixes

- **dependencies:** raise minimatch to 11.0.3 and qs override to 6.16.1 [#25](https://github.com/avi2d/checks/pull/25)

## 0.62.0

Released 2026-11-02.

### Features

- **testing:** picture one block at each screen size in chromium and webkit [#24](https://github.com/avi2d/checks/pull/24)

## 0.61.1

Released 2026-11-02.

### Fixes

- **changelog:** keep a release's section when its commit gets its tag [#23](https://github.com/avi2d/checks/pull/23)

## 0.61.0

Released 2026-11-01.

### Features

- **ci-wiring:** refuse a scheduled release in every repository [#22](https://github.com/avi2d/checks/pull/22)

## 0.60.0

Released 2026-10-31.

### Features

- **browser:** export the screen sizes for a site to import [#21](https://github.com/avi2d/checks/pull/21)

## 0.59.0

Released 2026-10-31.

### Features

- **browser:** add shared screen size presets and starter declaration [#20](https://github.com/avi2d/checks/pull/20)

## 0.58.1

Released 2026-10-29.

### Fixes

- **browser:** judge where the pointer lands instead of timing the hover [#19](https://github.com/avi2d/checks/pull/19)

## 0.58.0

Released 2026-10-29.

### Features

- **delivery:** scan commit messages for secrets and pack terms [#17](https://github.com/avi2d/checks/pull/17)

## 0.57.1

Released 2026-10-29.

### Fixes

- **complexity:** time out graphwalk and its dependency cruiser child [#18](https://github.com/avi2d/checks/pull/18)

## 0.57.0

Released 2026-10-27.

### Features

- **testing:** run live tier and four lint gates at night [#13](https://github.com/avi2d/checks/pull/13)

## 0.56.1

Released 2026-10-27.

### Fixes

- **complexity:** merge unused, exports and imports walks into one pass [#12](https://github.com/avi2d/checks/pull/12)

## 0.56.0

Released 2026-10-27.

### Features

- **core:** scope lint gates by changed paths and add desk run [#11](https://github.com/avi2d/checks/pull/11)

## 0.55.0

Released 2026-10-27.

### Features

- **dependencies:** defer the advisory scan to the scheduled run [#10](https://github.com/avi2d/checks/pull/10)

## 0.54.1

Released 2026-10-27.

### Fixes

- resolve the lint gate tools from the repository's own install [#9](https://github.com/avi2d/checks/pull/9)

## 0.54.0

Released 2026-10-27.

### Features

- **delivery:** fail fast when the release cannot run [#8](https://github.com/avi2d/checks/pull/8)

## 0.53.0

Released 2026-10-26.

### Features

- **delivery:** release each push to main as a versioned npm release [#5](https://github.com/avi2d/checks/pull/5)
- **delivery:** keep private terms out of commits and pull request text [#2](https://github.com/avi2d/checks/pull/2)

### Fixes

- **delivery:** skip pr-text scan when CHECKS_SECRETS_PACK is unset [#6](https://github.com/avi2d/checks/pull/6)
