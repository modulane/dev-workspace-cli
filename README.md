# Dev Workspace CLI

[![CI](https://github.com/modulane/dev-workspace-cli/actions/workflows/release.yml/badge.svg?branch=main)](https://github.com/modulane/dev-workspace-cli/actions/workflows/release.yml)
![Coverage](https://modulane.github.io/dev-workspace-cli/coverage.svg)
[![npm version](https://img.shields.io/npm/v/@modulane/dev-workspace-cli)](https://www.npmjs.com/package/@modulane/dev-workspace-cli)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Browse the projects in your development folder and run their scripts from one interactive menu, without changing directories or remembering script names.

Dev Workspace CLI detects each project's package manager (npm, pnpm, Yarn or Bun) and runs scripts with it, on Windows, macOS and Linux.

## Contents

- [Features](#features)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Usage](#usage)
- [Package managers](#package-managers)
- [Direct mode](#direct-mode)
- [Command-line options](#command-line-options)
- [Aliases](#aliases)
- [Configuration](#configuration)
- [Uninstalling](#uninstalling)
- [Security](#security)
- [Contributing](#contributing)
- [License](#license)

## Features

- **One menu for every project:** lists the projects in your workspace folder and the scripts defined in each `package.json`.
- **The right package manager:** runs each project's scripts with npm, pnpm, Yarn or Bun, detected from the project itself.
- **Fast to navigate:** type a few letters to find a project or script, recently used projects come first, and `dws web dev` runs a script in one command.
- **Stays out of the way:** scripts run in the project folder with full terminal output. Pressing Ctrl+C stops the script and brings you back to the menu.
- **Short commands:** start it with `dev-workspace`, `dws`, or an alias of your choice.
- **Remembers your workspace:** the workspace, recent projects and last scripts are stored in your user profile and survives updates and reinstalls.
- **Cross-platform:** tested on Windows, macOS and Linux with Node.js 22, 24 and 26.

## Installation

Dev Workspace CLI requires [Node.js](https://nodejs.org/) 22.13 or newer in the 22.x line, or 23.5 and later. Node.js 20 is no longer supported: it reached its end of life in April 2026.

```bash
npm install --global @modulane/dev-workspace-cli
```

This installs two equivalent commands, `dev-workspace` and the shorter `dws`.

## Quick start

1. Run the CLI:

   ```bash
   dws
   ```

2. On the first launch, enter the folder that contains your projects, for example:

   ```text
   ~/projects/
   ├── storefront/
   │   └── package.json
   ├── billing-api/
   │   └── package.json
   └── design-system/
       └── package.json
   ```

   You can type the path as you would in a terminal: `~/projects`, or a quoted path such as one copied with Explorer's **Copy as path**. The folder is saved as an absolute path, so the CLI opens it directly next time.

3. Choose a project, then one of its scripts. With this `package.json`:

   ```json
   {
     "scripts": {
       "dev": "node server.js",
       "build": "node build.js",
       "test": "node --test"
     }
   }
   ```

   the project menu offers `dev`, `build` and `test`. The script runs in the project folder with its normal output. When it ends, the CLI reports whether it succeeded, and you can run it again or return to the script list.

4. Next time, skip the menus: `dws storefront dev` runs that script directly.

## Usage

| Key                 | Action                                      |
| ------------------- | ------------------------------------------- |
| ↑ / ↓               | Move through a list                         |
| Page Up / Page Down | Move a page at a time                       |
| Home / End          | Go to the first or last entry               |
| Letters, digits, …  | Search the list                             |
| Backspace           | Delete the last character of the search     |
| Esc                 | Clear the search                            |
| Enter               | Open the selected project or run the script |
| Ctrl+C              | Stop a running script, or quit from a menu  |

Each list also has entries to go **Back**, **Exit**, or **Change workspace**.

The screens follow the width of your terminal, down to 40 columns: the header grows up to 72 columns, long workspace paths and script commands are cut to fit, and emoji or CJK characters in folder names never break the layout. Resizing the terminal while a list is open redraws it in place.

### Searching

Start typing in the project or script list to filter it. The characters you type must appear in the name in the same order, but not necessarily next to each other: `dsy` finds `design-system`. The best matches come first, preferring names that start with what you typed and matches at the start of words, and the matched characters are underlined. While you search, the **Back**, **Exit** and **Change workspace** entries are hidden, so Enter never picks one by accident.

### Recent projects and scripts

The five projects you used most recently are listed first, under **Recent**. In a project's script list, the cursor starts on the script you ran last, marked `(last run)`. This history is kept in a separate `state.json` file next to the configuration (see [Configuration](#configuration)); `dws --clear-history` deletes it without touching your settings.

### Running scripts

After a script ends, **Run again** is the default choice, so pressing Enter repeats it with the same arguments. **Back to scripts** returns to the list.

To pass arguments to a script, choose **Run with arguments…** at the end of the script list, pick the script, then type the arguments, for example `--port 4000`. Use quotes for an argument that contains spaces: `--title "my app"`. The arguments are passed to the script as they are, without a shell.

### Projects

Every subfolder of the workspace is listed as a project, including links to folders (symbolic links, and junctions on Windows), except folders that are never projects: names starting with a dot (such as `.git` or `.vscode`) and `node_modules`. Only the immediate subfolders are listed; projects nested deeper are not discovered.

Projects are sorted by name, ignoring case. Folders without a `package.json` have no scripts to run, so they appear dimmed at the end of the list, marked `(no package.json)`, and cannot be selected. A `package.json` that starts with a UTF-8 byte order mark, as Windows PowerShell 5.1 and some editors write it, is read normally, as npm does.

In the script list, the selected script's command is shown below the list, shortened to fit the terminal. Lifecycle hooks are listed with their main script instead of separately: with `prebuild`, `build` and `postbuild` scripts, the list shows only `build`, described as `node build.js  (+ prebuild, postbuild)`. Running `build` runs its hooks too, as the package manager normally does. A hook without its main script, such as `postinstall` on its own, is listed like any other script. In Yarn 2+ projects, which never run these hooks, every hook is listed as a separate script so you can still run it.

## Package managers

Each project's scripts run with the package manager that project uses. It is chosen in this order:

1. the `packageManager` field in `package.json`, for example `"packageManager": "pnpm@9.1.0"`;
2. the lockfile in the project folder:

   | Lockfile                                   | Package manager |
   | ------------------------------------------ | --------------- |
   | `pnpm-lock.yaml`                           | pnpm            |
   | `yarn.lock`                                | Yarn            |
   | `bun.lock`, `bun.lockb`                    | Bun             |
   | `package-lock.json`, `npm-shrinkwrap.json` | npm             |

3. npm, when neither is present.

The project screen shows the choice and the reason, for example `Package manager: pnpm (from pnpm-lock.yaml)`. If that package manager is not installed, the CLI explains how to install it. For pnpm and Yarn it suggests `corepack enable` on Node.js 24 and earlier; Node.js 25 and later no longer include Corepack, so there it suggests `npm install --global` first.

Whether `pre` and `post` hooks run is decided by the package manager: npm, pnpm, Bun and Yarn 1 run them, while Yarn 2 and later ignore them. The CLI recognises Yarn 2+ from a `packageManager` field such as `yarn@4.5.0`, or from a `yarn.lock` that starts with a `__metadata:` block, and then lists the hooks separately instead of grouping them.

Script arguments are passed the way each package manager expects them: after `--` for npm, directly after the script name for pnpm, Yarn and Bun. Either way, the script receives exactly the arguments you gave, including a `--` among them.

## Direct mode

Give a project, and optionally a script, to skip the menus:

```bash
dws web                        # open the scripts of the "web" project
dws web dev                    # run its "dev" script, then exit
dws web dev -- --port 4000     # pass everything after -- to the script
```

- The project is found by its exact name first, then ignoring case, then by the start of its name, as long as only one project starts that way: `dws des build` runs `build` in `design-system`. If several projects match, the CLI lists them.
- Any script in `package.json` can be run by name, including `pre` and `post` hooks.
- With a script, nothing is asked and the screen is not cleared, so direct mode also works in other scripts. The CLI exits with the script's exit code, or 128 plus the signal number if a signal stopped it, as shells do (130 after Ctrl+C). It exits with code 1 if it cannot start the script, for example when no workspace is saved yet.

## Command-line options

```text
dev-workspace [options] [project [script] [-- arguments]]
```

| Option                   | Description                                          |
| ------------------------ | ---------------------------------------------------- |
| `-w, --workspace <path>` | Use `<path>` as the workspace and save it            |
| `--config-path`          | Print the location of the configuration file         |
| `--clear-history`        | Forget the recent projects and last scripts          |
| `--add-alias <name>`     | Create another command that starts the CLI           |
| `--remove-alias <name>`  | Delete an alias created with `--add-alias`           |
| `--list-aliases`         | List the commands that start the CLI                 |
| `--reset`                | Delete the configuration, history and custom aliases |
| `-v, --version`          | Print the version                                    |
| `-h, --help`             | Show the help                                        |

## Aliases

Besides `dev-workspace` and `dws`, you can create your own command names:

```bash
dws --add-alias dev
dev
```

An alias is a small launcher file placed next to the `dev-workspace` command, in the folder where global commands are installed. It works immediately in every shell, including Command Prompt, PowerShell and Git Bash on Windows.

- `dws --list-aliases` lists every command, and `dws --remove-alias <name>` deletes one.
- Names that are already commands on your system, such as `ls`, are refused, so an alias never hides another program.
- The CLI only lists or deletes launchers it created.

Aliases require a global installation. If that folder needs administrator rights (for example `/usr/local/bin`), run the command with the same rights you used to install the CLI.

## Configuration

The workspace path is saved in the standard configuration folder of your operating system:

| Platform | Location                                                                                                 |
| -------- | -------------------------------------------------------------------------------------------------------- |
| Windows  | `%APPDATA%\dev-workspace-cli\config.json`                                                                |
| macOS    | `~/Library/Preferences/dev-workspace-cli/config.json`                                                    |
| Linux    | `$XDG_CONFIG_HOME/dev-workspace-cli/config.json` (defaults to `~/.config/dev-workspace-cli/config.json`) |

- `dws --config-path` prints the exact path on your machine.
- The `DEV_WORKSPACE_CONFIG` environment variable points the CLI at a different file.
- If you edit the file by hand, an editor that saves it with a UTF-8 byte order mark does no harm.
- To switch workspaces, choose **Change workspace** in the project list or run `dws --workspace <path>`. If the saved workspace no longer exists, the CLI asks for a new one.
- Versions before 0.3.0 stored the file in `~/.dev-workspace-cli/config.json`. If that file exists, it is moved to the new location automatically.

The history of recent projects and last scripts is kept apart from the settings, in `state.json` in the same folder as `config.json`. With `DEV_WORKSPACE_CONFIG`, it is named after your file instead (`dws.json` keeps it in `dws.state.json`), so it never overwrites a `state.json` of your own. It is only a convenience: if it is missing or damaged, the CLI starts with an empty history. `dws --clear-history` deletes it.

## Uninstalling

The configuration, history and custom aliases are kept outside the package, so they remain after an uninstall. To remove everything:

```bash
dws --reset
npm uninstall --global @modulane/dev-workspace-cli
```

## Security

Scripts run with your user account's permissions, exactly as if you ran them yourself. Only run scripts from projects you trust.

## Contributing

Bug reports, feature ideas and pull requests are welcome. Issues labelled [`good first issue`](https://github.com/modulane/dev-workspace-cli/labels/good%20first%20issue) and [`help wanted`](https://github.com/modulane/dev-workspace-cli/labels/help%20wanted) are ready to pick up. Pull requests are checked with Prettier, ESLint and the test suite in CI. See [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup, workflow, labels and release process, and the [roadmap](ROADMAP.md) for what is planned before 1.0.0.

## License

[MIT](LICENSE)
