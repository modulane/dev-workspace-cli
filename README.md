[![CI](https://github.com/modulane/dev-workspace-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/modulane/dev-workspace-cli/actions/workflows/ci.yml)
![Coverage](https://modulane.github.io/dev-workspace-cli/coverage.svg)
[![npm version](https://img.shields.io/npm/v/@modulane/dev-workspace-cli)](https://www.npmjs.com/package/@modulane/dev-workspace-cli)

# Dev Workspace CLI

An interactive command-line tool for browsing your development workspace and running their scripts without manually navigating between project folders.

## Features

- Browse project directories from a configurable workspace.
- Discover npm scripts from each project's `package.json`.
- Run scripts directly from the selected project's directory.
- Save your workspace configuration between launches.
- Use an interactive terminal interface with keyboard navigation.
- Run on Windows, macOS, and Linux.

## Requirements

- Node.js 20 or newer
- npm

## Installation

Install globally using npm:

```bash
npm install --global @modulane/dev-workspace-cli
```

Launch the CLI:

```bash
dev-workspace
```

or with the shorter built-in alias:

```bash
dws
```

## Getting started

On the first launch, the CLI asks you to select a workspace directory.

Choose the directory that contains your projects. For example:

```text
C:/dev/
├── foo-1/
│   └── package.json
├── foo-2/
│   └── package.json
└── foo-3/
    └── package.json
```

The CLI lists the immediate subdirectories of your workspace. Select a project to browse the npm scripts defined in its `package.json`, then choose a script to execute.

For example, a project with the following scripts:

```json
{
  "scripts": {
    "dev": "nuxt dev",
    "build": "nuxt build",
    "test": "vitest"
  }
}
```

will expose `dev`, `build`, and `test` in the project menu.

Scripts run from the selected project's directory, so relative paths and project-local dependencies resolve in the appropriate context.

## Package managers

Each project's scripts run with the package manager the project uses. The CLI decides in this order:

1. the `packageManager` field in `package.json`, for example `"packageManager": "pnpm@9.1.0"`;
2. the lockfile in the project folder: `pnpm-lock.yaml` (pnpm), `yarn.lock` (Yarn), `bun.lock` or `bun.lockb` (Bun), `package-lock.json` or `npm-shrinkwrap.json` (npm);
3. npm, when neither is present.

The project screen shows which tool will be used and why, for example `Package manager: pnpm (from pnpm-lock.yaml)`. If that tool is not installed, the CLI says so and explains how to install it.

To switch to another workspace later, choose **Change workspace** in the project list, or start the CLI with `--workspace <path>`.

## Options

```text
dev-workspace [options]

  -w, --workspace <path>   Use <path> as the workspace and save it
      --config-path        Print the configuration file location
      --add-alias <name>   Create another command that starts the CLI
      --remove-alias <name>
                           Delete an alias created with --add-alias
      --list-aliases       List the available commands
      --reset              Delete the saved configuration and aliases
  -v, --version            Print the version
  -h, --help               Show this help
```

## Aliases

The CLI installs two commands: `dev-workspace` and the shorter `dws`. You can add your own names:

```bash
dws --add-alias dev
dev
```

An alias is a small launcher file created next to the `dev-workspace` command, in the folder where your package manager installs global commands. It works immediately in every shell, including cmd, PowerShell and Git Bash on Windows.

- `--list-aliases` shows every available command.
- `--remove-alias <name>` deletes an alias.
- A name that is already a command on your system, such as `ls` or another tool, is refused, so an alias never hides an existing program.
- The CLI only lists or deletes launchers it created itself.

Aliases need a global install. If the folder needs administrator rights (for example `/usr/local/bin`), run the command with the same rights you used to install the CLI.

## Workspace configuration

Your workspace path is saved in your operating system's standard location for user configuration:

| Platform | Location                                                                                                 |
| -------- | -------------------------------------------------------------------------------------------------------- |
| Linux    | `$XDG_CONFIG_HOME/dev-workspace-cli/config.json` (defaults to `~/.config/dev-workspace-cli/config.json`) |
| macOS    | `~/Library/Preferences/dev-workspace-cli/config.json`                                                    |
| Windows  | `%APPDATA%\dev-workspace-cli\config.json`                                                                |

Run `dev-workspace --config-path` to print the exact path on your machine. To use a different file, set the `DEV_WORKSPACE_CONFIG` environment variable to its path.

The configuration is stored separately from the package, so updating, reinstalling, or uninstalling the CLI keeps your workspace preference.

Versions 0.1.x stored the configuration in `~/.dev-workspace-cli/config.json`. If that file exists, the CLI moves it to the new location automatically on the next launch.

If the saved workspace is no longer accessible, the CLI offers to configure another one.

## Uninstalling

Because the configuration and your custom aliases outlive the package, delete them before uninstalling if you want to remove every trace of the CLI:

```bash
dev-workspace --reset
npm uninstall --global @modulane/dev-workspace-cli
```

## Development

Clone the repository and install dependencies:

```bash
npm install
```

Start the CLI locally:

```bash
npm start
```

Run the automated tests:

```bash
npm test
```

Run the complete local verification command:

```bash
npm run check
```

### Workflow

Every change is made on a short-lived branch and reaches `main` through a pull request:

1. Create a branch named after the change, for example `feat/project-search`, `fix/ctrl-c` or `docs/readme`.
2. Commit and push to it as often as needed. Nothing is released from a branch.
3. Open a pull request. CI runs the full test matrix, and a check makes sure the title follows [Conventional Commits](https://www.conventionalcommits.org/), for example `feat: add project search`.
4. Squash-merge it. The pull request title becomes the single commit on `main`, which decides the release described below.

### Releasing

Releases are automatic. When CI passes for a push to `main`, the Release workflow runs [semantic-release](https://semantic-release.gitbook.io/), which reads the commit messages since the last release:

| Commit message                                  | Result                        |
| ----------------------------------------------- | ----------------------------- |
| `fix: …`                                        | Patch release (0.3.0 → 0.3.1) |
| `feat: …`                                       | Minor release (0.3.0 → 0.4.0) |
| `docs: …`, `style: …`, `chore: …`, `test: …`, … | No release                    |

It then publishes the package to npm, creates the git tag and a GitHub release with generated notes. The version in `package.json` stays `0.0.0-development`; the real version only exists in git tags and on npm.

The new version can take up to about ten minutes to appear on npm after the workflow finishes, because npm processes packages published with provenance in the background. The git tag and the GitHub release appear immediately.

The workflow can also be started by hand from the Actions tab.

## Limitations

- The CLI discovers immediate subdirectories rather than recursively searching for projects.
- A project must have a `package.json` with a `scripts` object to expose npm scripts.
- Project scripts execute with the permissions of the current user. Only run scripts from projects you trust.

See the [roadmap](ROADMAP.md) for the features planned up to version 1.0.0.

## Contributing

Bug reports, feature suggestions, and contributions are welcome. Please include clear reproduction steps when reporting a problem. Pull requests follow the [workflow](#workflow) described above.

## License

MIT
