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
- **Fast to navigate:** type a few letters to find a project or script, recently used projects come first, and `dws web dev` runs a script in one command. Menus also work with the mouse, with buttons for every action.
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

2. On the first launch, choose the folder that contains your projects, for example:

   ```text
   ~/projects/
   ├── storefront/
   │   └── package.json
   ├── billing-api/
   │   └── package.json
   └── design-system/
       └── package.json
   ```

   The CLI lists the usual project folders that exist in your home folder (`~/dev`, `~/projects`, `~/code`, `~/src` and `~/repos`), each with the number of projects in it, so one click or Enter is often enough. For any other folder, pick **… Enter another path**, or, when none of them exist, the CLI asks for the path straight away.

   You can type the path as you would in a terminal: `~/projects`, or a quoted path such as one copied with Explorer's **Copy as path**. The folder is saved as an absolute path, so the CLI opens it directly next time.

3. Then choose the accent colour of the CLI: cyan (the default), blue, purple, magenta, pink, orange, teal, sky, lavender, coral, gold, or no colour (bold text). Each name is shown in its own colour, and moving the cursor previews it on the whole screen. Both answers are saved, so later launches ask neither; `dws --set-color <name>` changes the colour at any time.

4. Choose a project, then one of its scripts. With this `package.json`:

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

5. Next time, skip the menus: `dws storefront dev` runs that script directly.

## Usage

| Key                 | Action                                      |
| ------------------- | ------------------------------------------- |
| ↑ / ↓               | Move through a list, and up to the buttons  |
| Page Up / Page Down | Move a page at a time                       |
| Home / End          | Go to the first or last entry               |
| Letters, digits, …  | Search the list                             |
| Backspace           | Delete the last character of the search     |
| Esc                 | Clear the search; with no search, go back   |
| Enter               | Open the selected project or run the script |
| →                   | Run the selected script with arguments      |
| Tab / Shift+Tab     | Move to the buttons and back to the list    |
| ← / →               | Move between buttons                        |
| Ctrl+C              | Stop a running script, or quit from a menu  |

Escape goes back one screen: from a project to the project list, from the workspace list or path prompt to the project list, and from the project list it exits. While you are searching, it only clears the search. The help line under each menu shows what it does (`esc back` or `esc exit`).

Every menu opens with a small box that shows where you are: the name of the workspace folder, followed by the project you are in (`◆ dev › web-app`), the workspace folder, and in a project, its package manager on the right. The box also holds the buttons of the screen, on the right of the workspace line: **⚙ Workspace** and **✕ Exit** in the project list, **← Back** and **… Run with args** in a project. The buttons sit just above the list: press ↑ on the first entry to reach the first button, ↑ again for the next one, and ↓ to come back (Tab and Shift+Tab work too, and ← and → move between buttons). The focused button is shown in reverse, or between brackets without colours, and Enter presses it. Each script's command is shown next to its name, in a column of its own, and tags such as `last run` sit at the right edge. When a list is longer than the window, `▲ 3 more` and `▼ 12 more` show how many entries are hidden above and below. The layout stays within 100 columns on wide terminals. Long workspace paths are shortened in the middle (`C:Users…projectsweb`), keeping the folders that tell them apart, and script commands are cut with `…` to fit, and emoji or CJK characters in folder names never break the layout.

The menus are drawn on the terminal's alternate screen, as `less` and `vim` do, so resizing the window redraws the whole screen cleanly and the menus never fill your scrollback. A script's output appears on the normal screen and stays there after you return to the menus.

### Colours

Colour marks where you are: the accent colour (cyan unless you chose another one on the first launch or with `dws --set-color <name>`) for the selected entry, the current project in the header and your search, and a faint version of it for the header's border. Green, red and yellow are kept for results and warnings, so they are not offered as accents. Buttons take the accent too: on a grey background under the mouse, and reversed when focused with the keyboard. In a project, the `last run` tag of the script you ran last is in the accent, so you can find it again after moving the cursor. The Git branch of each project gets a softer colour (`main`, `master` and `trunk` in one, any other branch in another). The rest is dim text. The workspace and arguments prompts use the same colours as the menus. Everything still reads without colour: the selected entry keeps its `❯` marker, and group titles are in capitals.

The accents other than cyan, blue and magenta use the terminal's 256-colour palette, which every current terminal supports.

Colours are on in a terminal and off when output is redirected to a file or another program. Set `NO_COLOR` to turn them off, or `FORCE_COLOR` to turn them on anyway (`FORCE_COLOR=0` turns them off). `FORCE_COLOR` wins when both are set, as in Node.js.

### Searching

Start typing in the project or script list to filter it. The characters you type must appear in the name in the same order, but not necessarily next to each other: `dsy` finds `design-system`. The best matches come first, preferring names that start with what you typed and matches at the start of words, and the matched characters are underlined. Typing always goes to the search, and the buttons are never part of the list, so Enter never presses one by accident.

### Mouse

In terminals that report the mouse, you can also use it in every menu. One click opens a project, since **← Back** undoes it. A script needs a deliberate click, so a stray one never starts a build: the script under the pointer shows two buttons at the end of its row, **▶ run** and **… run with args**, divided by a thin line, or click the script once to select it and again, or double-click, to run it. The entry under the pointer is marked `›`. Every button in the header box can be clicked. Clicking `▲ n more` or `▼ n more` moves a page. The keyboard works exactly as before.

The scroll wheel alone is enough to get around: it moves as ↑ and ↓ do, so scrolling up past the first entry reaches the buttons, and pressing the wheel (middle-click) opens the selected entry or presses the focused button, wherever the pointer is. The hint under each menu mentions it. Only searching and the questions that ask you to type, such as the workspace path or script arguments, need the keyboard.

While a menu is open, the mouse is used by the menu instead of selecting text; hold Shift or Option, depending on the terminal, and drag to select text anyway. Mouse reporting and the alternate screen are switched off before a script runs and whenever the CLI exits. To use only the keyboard, run `dws --no-mouse` for one run, or `dws --set-mouse off` to keep it that way; `dws --set-mouse on` turns the mouse back on.

| Terminal                        | Mouse                                                                        |
| ------------------------------- | ---------------------------------------------------------------------------- |
| Windows Terminal                | Works                                                                        |
| Classic Windows console         | Works                                                                        |
| VS Code integrated terminal     | Works                                                                        |
| macOS Terminal                  | Partial: clicks land slightly off-centre; `›` shows which entry a click hits |
| Git Bash                        | Off: Git Bash reports no mouse events                                        |
| iTerm2, Linux terminals, others | Not checked yet                                                              |

In a terminal without full support, the first menu shows a short note, once: what does not work and how to get full mouse support, or, in a terminal not checked yet, a request for help in [#26](https://github.com/modulane/dev-workspace-cli/issues/26).

### Recent projects and scripts

The five projects you used most recently are listed first, under **Recent**. In a project's script list, the cursor starts on the script you ran last, tagged `last run`. This history is kept in a separate `state.json` file next to the configuration (see [Configuration](#configuration)); `dws --clear-history` deletes it without touching your settings.

### Running scripts

A script runs on the normal screen, under the header box with the project and script as breadcrumb (`◆ dev › web-app › build`) and the command it runs (`▶ npm run build`). When it ends, a line says how it went and how long it took: `✔ build finished in 4.2s` in green, or `✖ build failed · exit 1 · 0.8s` in red, with the signal name (such as `SIGINT`) instead of the exit code when a signal stopped it.

Then **↻ Run again** and **← Back to scripts** sit side by side. Run again is focused, so pressing Enter, or `r`, repeats the script with the same arguments; Esc goes back to the list.

To pass arguments to a script, press → on it, or click its **… run with args** button, then type the arguments, for example `--port 4000`. The **… Run with args** button in the header box does the same after asking which script to run. Use quotes for an argument that contains spaces: `--title "my app"`. The arguments are passed to the script as they are, without a shell. Press Esc at the arguments prompt to go back to the scripts without running anything.

### Projects

Every subfolder of the workspace is listed as a project, including links to folders (symbolic links, and junctions on Windows), except folders that are never projects: names starting with a dot (such as `.git` or `.vscode`) and `node_modules`. Only the immediate subfolders are listed; projects nested deeper are not discovered.

Projects are sorted by name, ignoring case. Folders without a `package.json` have no scripts to run, so they appear dimmed at the end of the list, tagged `no package.json`, and cannot be selected. A `package.json` that starts with a UTF-8 byte order mark, as Windows PowerShell 5.1 and some editors write it, is read normally, as npm does.

Next to each project, the list shows how many scripts it has and its Git branch (`12 scripts · main`, or the short commit when nothing is checked out), with its package manager on the right. These details are read only for the projects in view, as they scroll into the window, so a large workspace still opens at once. They are kept for the rest of the session, and read again for a project after you open it. The branch is read from `.git/HEAD`, so Git does not need to be installed.

In the script list, each script's command is shown next to its name, shortened to fit the terminal. Lifecycle hooks are listed with their main script instead of separately: with `prebuild`, `build` and `postbuild` scripts, the list shows only `build`, with the command `node build.js  (+ prebuild, postbuild)`; when the command is shortened, the hooks are always kept. Running `build` runs its hooks too, as the package manager normally does. A hook without its main script, such as `postinstall` on its own, is listed like any other script. In Yarn 2+ projects, which never run these hooks, every hook is listed as a separate script so you can still run it.

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

The box at the top of the project screen shows the choice and the reason, for example `pnpm · pnpm-lock.yaml`. If that package manager is not installed, the CLI explains how to install it. For pnpm and Yarn it suggests `corepack enable` on Node.js 24 and earlier; Node.js 25 and later no longer include Corepack, so there it suggests `npm install --global` first.

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
- Without a script, the CLI needs a terminal to read keys from. When its input is redirected (`dws < file`, or in a CI job), it exits with code 1 and a message saying how to run a script directly, instead of waiting for keys that never come.

## Command-line options

```text
dev-workspace [options] [project [script] [-- arguments]]
```

| Option                   | Description                                                  |
| ------------------------ | ------------------------------------------------------------ |
| `-w, --workspace <path>` | Use `<path>` as the workspace and save it                    |
| `--no-mouse`             | Use only the keyboard in menus, for this run                 |
| `--set-mouse <on\|off>`  | Save whether menus use the mouse                             |
| `--set-color <name>`     | Save the accent colour (see [Colours](#colours))             |
| `--config-path`          | Print the location of the configuration file                 |
| `--clear-history`        | Forget the recent projects and last scripts                  |
| `--add-alias <name>`     | Create another command that starts the CLI                   |
| `--remove-alias <name>`  | Delete an alias created with `--add-alias`                   |
| `--list-aliases`         | List the commands that start the CLI                         |
| `--reset`                | Delete the configuration, history and custom aliases         |
| `-v, --version`          | Print the version                                            |
| `-h, --help`             | Show the help (coloured as described in [Colours](#colours)) |

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
- The accent colour chosen on the first launch is saved as `"color"`: `{ "workspace": "…", "color": "teal" }`. `dws --set-color <name>` changes it. A file saved by a version without this setting keeps cyan and is never asked again.
- `dws --set-mouse off` saves `"mouse": false` in the file, so menus use only the keyboard: `{ "workspace": "…", "mouse": false }`. `dws --set-mouse on` saves `true`. Changing the workspace keeps these settings, and they can be saved before any workspace is chosen.
- To switch workspaces, press the **⚙ Workspace** button in the project list or run `dws --workspace <path>`. The button shows the same folders as the first launch, with the current one tagged `current`, and **… Enter another path**. In that list, and at the path prompt, Esc keeps the current workspace and goes back to the projects. If the saved workspace no longer exists, the CLI asks for a new one.
- Versions before 0.3.0 stored the file in `~/.dev-workspace-cli/config.json`. If that file exists, it is moved to the new location automatically.

The history of recent projects and last scripts, and which mouse notes were shown, is kept apart from the settings, in `state.json` in the same folder as `config.json`. With `DEV_WORKSPACE_CONFIG`, it is named after your file instead (`dws.json` keeps it in `dws.state.json`), so it never overwrites a `state.json` of your own. It is only a convenience: if it is missing or damaged, the CLI starts with an empty history. `dws --clear-history` deletes it.

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
