# Contributing

Thank you for helping improve Dev Workspace CLI. This guide covers the development setup, the code layout, the change workflow and how releases are published.

## Development setup

Requirements: Node.js 20.17, 22.13 or 23.5 and later (the versions the dependencies support), and npm.

```bash
git clone https://github.com/modulane/dev-workspace-cli.git
cd dev-workspace-cli
npm install
```

| Command            | Purpose                                                     |
| ------------------ | ----------------------------------------------------------- |
| `npm start`        | Run the CLI from the working copy                           |
| `npm test`         | Run the test suite                                          |
| `npm run coverage` | Run the tests with a coverage report (minimum 80% of lines) |
| `npm run format`   | Format every file with Prettier                             |
| `npm run check`    | Check formatting and run the tests, as CI does              |

Some tests run a real script with each supported package manager. Package managers that are not installed are skipped locally; CI installs all of them and sets `REQUIRE_ALL_PACKAGE_MANAGERS=1` so none is skipped there. These tests also check whether each tool runs `pre`/`post` hooks, and that script arguments reach the script unchanged. Yarn 2+, which does not run hooks, is tested with the `@yarnpkg/cli-dist` devDependency: the installed `yarn` (Yarn 1 is enough) hands over to it through `yarnPath`, so Corepack is not needed.

When testing the real command by hand, point it at a temporary configuration so your own settings are not changed. The history (`state.json`) is written next to it, so give it a folder of its own:

```bash
DEV_WORKSPACE_CONFIG=/tmp/dws-test/config.json npm start
DEV_WORKSPACE_CONFIG=/tmp/dws-test/config.json npm start -- web dev
```

## Code layout

`index.js` is the executable; everything else lives in `lib/`:

| File                  | Responsibility                                                 |
| --------------------- | -------------------------------------------------------------- |
| `cli.js`              | Option handling, workspace setup, menus and direct mode        |
| `args.js`             | Command-line parsing, the `--help` text, splitting arguments   |
| `config.js`           | Configuration file location, reading, writing and migration    |
| `state.js`            | The history of recent projects and last scripts (`state.json`) |
| `workspace.js`        | Listing projects, reading their scripts, resolving typed paths |
| `package-managers.js` | Detecting each project's package manager                       |
| `commands.js`         | Running a script with that package manager                     |
| `json.js`             | Parsing JSON files, ignoring a leading byte order mark         |
| `aliases.js`          | Creating, listing and removing custom aliases                  |
| `prompts.js`          | The questions and menus shown by `cli.js`                      |
| `list.js`             | The list used by every menu: keys, drawing, search             |
| `fuzzy.js`            | Fuzzy matching and ranking for the list search                 |
| `ui.js`               | Colours, the header and screen clearing                        |

Menus use the list in `list.js`, which owns the terminal while it is open; free-text and yes/no questions still use `@inquirer/prompts`. Test the list through `createList()` with fake input and output streams, as `test/list.test.js` does, rather than in a real terminal.

Each file in `lib/` starts with a comment describing what it contains and how it is used. Keep that comment accurate when you change the file.

Modules receive their side effects (file system, prompts, process spawning) as parameters with real defaults, so tests can replace them with fakes. Tests live in `test/`, one file per module.

## Workflow

Every change is made on a short-lived branch and reaches `main` through a pull request:

1. Create a branch named after the change: `feat/project-search`, `fix/ctrl-c`, `docs/readme`, …
2. Commit and push as often as needed. Nothing is released from a branch.
3. Open a pull request. CI runs the test matrix (Windows, macOS and Linux with Node.js 20, 22, 24 and 26), and a check verifies that the title follows [Conventional Commits](https://www.conventionalcommits.org/). Pull requests that change `.github/` are also audited by [zizmor](https://docs.zizmor.sh/). A final **CI passed** job succeeds only when every test and coverage job has passed. It and the title check are the checks that must pass before a pull request can be merged, so changing the test matrix never requires changing the repository rules.
4. Squash-merge it. The pull request title becomes the only commit on `main`.

The pull request title decides what is released, so choose its type carefully:

| Title starts with                                                           | Release                          |
| --------------------------------------------------------------------------- | -------------------------------- |
| `fix:`                                                                      | Patch, for example 0.4.0 → 0.4.1 |
| `feat:`                                                                     | Minor, for example 0.4.0 → 0.5.0 |
| `docs:`, `style:`, `refactor:`, `perf:`, `test:`, `build:`, `ci:`, `chore:` | None                             |

Keep the summary lowercase and in the imperative: `feat: add project search`, not `Feat: Added project search`.

**Do not mark changes as breaking before 1.0.0.** A `!` after the type (`feat!:`) or a `BREAKING CHANGE:` footer makes a major release, which would publish 1.0.0 early. Until then, describe incompatible changes in the pull request and release them as `feat:`.

### Labels and reviews

The **Pull request labels** workflow labels each pull request from its title, and updates the labels when the title is edited:

| Title type                                      | Kind label      | Release label    |
| ----------------------------------------------- | --------------- | ---------------- |
| `feat:`                                         | `enhancement`   | `release: minor` |
| `fix:`                                          | `bug`           | `release: patch` |
| `docs:`                                         | `documentation` | `release: none`  |
| `ci:`, `build:`                                 | `ci`            | `release: none`  |
| `refactor:`, `perf:`, `test:`, `style:`, others | `maintenance`   | `release: none`  |

A `!` after the type replaces the release label with `release: major`, so a breaking change is visible before it is merged. The workflow also assigns a new pull request to its author, and [`CODEOWNERS`](.github/CODEOWNERS) requests a review from the maintainer.

The labels themselves are defined in [`.github/labels.json`](.github/labels.json). When that file changes on `main`, the **Labels** workflow creates the missing labels and updates the others. It never deletes a label; remove one in the repository settings after taking it out of the file.

## Releases

Releases are fully automated with [semantic-release](https://semantic-release.gitbook.io/). Nobody publishes by hand.

1. A pull request is merged into `main`.
2. The **Release** workflow starts on that commit. Its first job runs the **CI** workflow: the full test matrix and the coverage badge.
3. If CI succeeds, the publish job runs semantic-release in the same run, on the same commit.
4. semantic-release reads the commits since the last release tag. If none of them is a `fix:` or `feat:`, it stops and nothing is published.
5. Otherwise it computes the next version and:
   - publishes the package to npm through [trusted publishing](https://docs.npmjs.com/trusted-publishers), so no npm token is stored in the repository, and with a provenance attestation linking the package to this workflow run;
   - creates the `vX.Y.Z` git tag and a GitHub release with notes generated from the commits.

The version in `package.json` is always `0.0.0-development`. The real version exists only in git tags and on npm; semantic-release writes it into the package at publish time.

The git tag and GitHub release appear as soon as the workflow ends. The new version can take up to about ten minutes to appear on npm.

The Release workflow can also be started by hand from the Actions tab. It then performs the same steps on the latest commit of `main`. Check **dry-run** to see the next version and its release notes without publishing anything.

### Workflow security

The publish job can request an OIDC token that publishes to npm, so the workflows keep what it runs to a minimum:

- Every action is pinned to a full commit SHA, with its version in a comment. Dependabot proposes updates once a week, only for releases that are at least seven days old. Its pull requests are titled `ci:`, so they never trigger a release.
- Each job asks only for the permissions it needs, and each permission says what it is for.
- The publish job runs only on `main`, in the `npm` environment. It keeps no git credential on disk, installs dependencies without running their install scripts, and verifies their registry signatures. A new dependency that needs an install script will not work in that job, so check this before adding one.

### When a release is broken

Publish a fix through a normal `fix:` pull request, then deprecate the broken version so npm warns anyone installing it:

```bash
npm login
npm deprecate "@modulane/dev-workspace-cli@X.Y.Z" "Broken: <what is wrong>. Upgrade to the latest version."
```

This needs a maintainer's npm account; the release workflow cannot deprecate versions.
