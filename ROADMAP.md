# Roadmap to 1.0.0

This document plans the path to a stable 1.0.0 release. Each milestone has a theme, a list of deliverables and the conditions that must be true before it is complete.

Milestones are not tied to version numbers. Releases are published automatically as work lands (see [Release process notes](#release-process-notes)), so one milestone usually spans several releases. When a milestone is complete, its heading records the release that finished it.

**Goal for 1.0.0:** the CLI should be the quickest way to reach and run any script in any JavaScript project on your machine. It must work with every major package manager and operating system, and offer a stable interface that users and scripts can rely on.

## Principles

These apply to every milestone:

- **Zero setup for the common case.** Sensible defaults first; configuration is optional.
- **Never surprise the user.** No silent data loss, and no prompts in non-interactive use. A failure always exits with a non-zero code.
- **Keep it small.** Add a dependency only when it replaces substantial, tricky code (for example, terminal width or fuzzy matching).
- **Every feature ships with tests and documentation.** Coverage stays at or above 90% of lines, and the README is updated in the same pull request.
- **Cross-platform by default.** Every change is checked by CI on Windows, macOS and Linux with Node 22, 24 and 26.

## Overview

| Milestone                       | Status                                    | Highlights                                                                |
| ------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------- |
| Interface refresh               | Released in 0.2.0, since removed from npm | New header, prompt formatting, screen clearing                            |
| Foundations                     | Released in 0.3.0                         | Platform config location, CLI flags, aliases, Ctrl+C fix                  |
| Works with every project        | Released in 0.5.0                         | Package manager detection, project filtering, lifecycle scripts           |
| Fast navigation                 | Released in 0.6.0                         | Fuzzy search, recent items, direct mode, script arguments                 |
| A polished interface            | Released in 0.9.0                         | Mouse support, framed header, buttons, themes, project details, first run |
| Terminal compatibility          | Planned                                   | Mouse and screens checked in macOS Terminal, iTerm2 and Linux terminals   |
| Bigger workspaces               | Released in 0.10.0                        | Monorepos, nested projects, multiple named workspaces                     |
| Configuration and scripts       | Planned                                   | Versioned config schema, `config` command, JSON output, project commands  |
| Hardening and release candidate | Planned                                   | Linting, type checks, end-to-end tests, interface freeze, feedback period |
| Stable                          | Planned: 1.0.0                            | Semver guarantees for flags, config and exit codes                        |

Milestones are listed in their planned order. Work on a later milestone can start early when it unblocks something, but a milestone counts as complete only when all its items and its "Done when" condition are met.

---

## Interface refresh _(released in 0.2.0, since removed from npm)_

- [x] Boxed header showing the workspace and current section.
- [x] Formatted project and script menus, with the script command shown as a description.
- [x] The screen is cleared between menus.

## Foundations _(released in 0.3.0)_

- [x] Store the configuration in the platform's config directory, and move the legacy `~/.dev-workspace-cli` file automatically.
- [x] `DEV_WORKSPACE_CONFIG` environment variable to override the config path.
- [x] Flags: `--workspace`, `--config-path`, `--reset`, `--version`, `--help`.
- [x] "Change workspace" entry in the project list.
- [x] Pressing Ctrl+C in a running script returns to the menu instead of closing the CLI.
- [x] Non-zero exit code when the workspace cannot be read.
- [x] Prettier formatting enforced in `npm run check`.
- [x] Built-in `dws` command, and custom aliases with `--add-alias`, `--remove-alias` and `--list-aliases`.

## Works with every project _(released in 0.5.0)_

Before this milestone, the CLI assumed npm and listed every folder. It made the CLI correct for real-world workspaces.

### Package manager detection

- [x] Detect the package manager per project, in this order:
  1. the `packageManager` field in `package.json` (for example, `pnpm@9.1.0`);
  2. the lockfile: `pnpm-lock.yaml`, `yarn.lock`, `bun.lock` / `bun.lockb`, `package-lock.json`;
  3. npm as the fallback.
  - [x] Read a `package.json` that starts with a UTF-8 byte order mark, as npm does, both for the `packageManager` field and for the script list; the configuration file too ([#14](https://github.com/modulane/dev-workspace-cli/issues/14)).
- [x] Run scripts with the detected tool (`pnpm run`, `yarn run`, `bun run`, `npm run`).
- [x] Show which package manager will be used in the project screen.
- [x] When the detected tool is not installed, show an actionable error naming the tool and how to install it (for example, `corepack enable`).
  - [x] Suggest `corepack enable` only on Node.js 24 and earlier: Node.js 25 and later no longer ship Corepack, so the hint starts with `npm install --global` there ([#15](https://github.com/modulane/dev-workspace-cli/issues/15)).

### Project filtering

The project list currently shows every subfolder of the workspace, including folders that can never be projects. Opening one of them leads to an empty "No scripts found" screen.

- [x] Leave out of the project list the workspace subfolders that are never projects: names starting with a dot (`.git`, `.vscode`, `.idea`, …) and `node_modules`.
- [x] Show subfolders without a `package.json` dimmed and unselectable, at the end of the list. A setting to hide them entirely is part of [Configuration and scripts](#configuration-and-scripts).
- [x] Sort projects ignoring case, with numbers compared by value (`app2` before `app10`).

### Scripts

- [x] Group `pre*` and `post*` lifecycle scripts under their main script, so `pretest` is not listed as a separate entry. Hooks whose main script does not exist, such as `postinstall` on its own, stay listed.
  - [x] Except in Yarn 2+ projects, which never run these hooks: recognised from the `packageManager` field or the `yarn.lock` format, they list every hook as a separate script. CI runs a real script with Yarn 4 to check that its hooks are skipped ([#8](https://github.com/modulane/dev-workspace-cli/issues/8)).
- [x] Show the script command as the description, truncated to the terminal width, followed by its hooks.

**Done when:** a workspace that mixes npm, pnpm, Yarn and Bun projects runs every script with the right tool on all three operating systems in CI.

## Fast navigation _(released in 0.6.0)_

The CLI should be faster than typing `cd` and `npm run`.

- [x] **Own list prompt:** replace Inquirer's `select` with a small list component that the CLI controls fully: rendering, scrolling, key handling and the row position of every item. It is the base for fuzzy search here and for mouse support in [A polished interface](#a-polished-interface-released-in-090).
  - [x] It decodes raw terminal input itself, so escape sequences it does not use yet, such as mouse reports, are recognised and ignored instead of being typed into the search.
  - [x] Raw mode is switched off and the cursor shown again on every exit path, including Ctrl+C and the process exiting while a list is open.
- [x] **Fuzzy search** in the project and script lists: typing filters the list (subsequence matching, best matches first) and Escape clears the filter.
  - [x] Matches at the start of the name or of a word, and consecutive characters, rank first; matched characters are underlined.
  - [x] "Back", "Exit" and "Change workspace" are hidden while searching, so Enter never picks one by accident.
- [x] **Recent items:** the five most recently used projects appear at the top of the list, and each project remembers its last script. Stored in a separate `state.json` next to the config, so clearing history never touches settings.
  - [x] `--clear-history` deletes it; `--reset` deletes it with the configuration.
  - [x] A missing or damaged `state.json` means an empty history, never an error, and it is written through a temporary file.
- [x] **Direct mode:** `dev-workspace <project> [script]` skips the menus.
  - The project name is matched exactly first, then by unique prefix.
  - Without a script, open that project's script menu.
  - With a script, run it and exit with the script's exit code.
  - [x] With a script it never prompts or clears the screen: a missing workspace is an error (exit code 1), and a script stopped by a signal exits with 128 plus the signal number, as shells do.
- [x] **Script arguments:** `dev-workspace web dev -- --port 4000` passes everything after `--` to the script. In the menu, a "Run with arguments…" option asks for them.
  - [x] Each package manager gets them the way it expects (after `--` for npm, Yarn 1 only when they contain a `--`, otherwise directly). CI runs a real script with every tool, including Yarn 4, to check that the script receives them unchanged.
- [x] **Re-run:** after a script finishes, offer "Run again" as the default choice next to "Back".

**Done when:** opening and running a known script takes one command, and finding any project in a 50-project workspace takes at most three keystrokes plus Enter.

Both are met: `dws <project> <script>` runs a script in one command, and a test checks the keystroke goal on a 50-project workspace of deliberately similar names (`web`, `web-app`, `web-ui`, …), counting typed characters and Down presses.

## A polished interface _(released in 0.9.0)_

The CLI should look clean, and stay correct, in every terminal. Checking it in each terminal moved to its own milestone, [Terminal compatibility](#terminal-compatibility), so the interface could ship once its code was done.

The design is mouse-first and keyboard-complete. The list is the focus of every screen, and the frame around it stays quiet: one thin line style, one accent colour for "you are here" (cyan, or the one chosen on the first launch), a muted colour for the Git branch, and green, red and yellow only for results and warnings, and hierarchy that still reads with `NO_COLOR`. Everything on screen that looks clickable is clickable, hover shows what a click will do, and every click has a keyboard equivalent. Safe actions such as opening a project take one click; running a script takes a deliberate one.

### Mouse support

Terminals can report mouse events as escape sequences (SGR mouse mode, `\x1b[?1000h` and `\x1b[?1006h`). Each click arrives on stdin with its row and column, which the list prompt from [Fast navigation](#fast-navigation-released-in-060) maps to the item drawn there.

- [x] Click an item to select it; click the selected item again (or double-click) to open it. Terminals send a double-click as two separate presses, so clicks are ignored for about 300 ms after an item opens; otherwise the second press lands on the next screen.
- [x] Hover marks the item under the pointer with `›`, in terminals that report motion.
- [x] The scroll wheel moves through long lists, and pressing the wheel (the middle button) opens the selected item.
- [x] Clickable "Back" and "Exit" entries on every screen.
- [x] Mouse reporting is switched on only while a menu is shown. It is switched off before a script starts, and on every exit path: normal exit, Ctrl+C, errors and crashes. A terminal must never be left in mouse mode. Signals such as `kill` or a closing window count too: on macOS and Linux the list restores the terminal, then lets the signal end the process. Windows ends a process killed from outside (Task Manager, `taskkill /f`) at once, so nothing can run then.
- [x] Turned off automatically in terminals that do not report mouse events. Users can also disable it for one run with `--no-mouse`, or for good with `--set-mouse off`, because it replaces the terminal's normal text selection while a menu is open (Shift or Option + drag still selects text).
- [x] Keyboard navigation keeps working exactly as before; the mouse is an addition, never a requirement.
- [x] **Buttons:** map clicks by column as well as row, so a screen can hold buttons side by side: toolbar buttons in the header box (Workspace and Exit, or Back and Run with args), `▶ run` and `… run with args` buttons on the hovered script, kept apart by a divider, and `▲ n more` / `▼ n more` scroll hints. Running a script takes its button or a second click, so a stray click never starts a build. The buttons sit one step above the list: ↑ or the wheel past the first item reaches them, ↓ comes back, and pressing the wheel presses the focused one, so each one also works from the keyboard or the wheel alone (Tab and Shift+Tab too). The name in the header is not a button: Back does that job [#68](https://github.com/modulane/dev-workspace-cli/issues/68).
- [x] Terminals without full support say so. The CLI recognises the terminal from its environment (`TERM_PROGRAM`, `WT_SESSION`, `MSYSTEM`, …) and looks it up in the table below:
  - **Partial or no mouse events** (macOS Terminal, Git Bash): a short note under the menu says what does not work and how to get full mouse support, for example the VS Code integrated terminal on macOS.
  - **Not recorded yet** (iTerm2, Linux terminals, anything unrecognised): the note says mouse support is untested there and asks for help checking it in [#26](https://github.com/modulane/dev-workspace-cli/issues/26).
  - The note is shown once per terminal, not on every menu, and never when the mouse is turned off (`--no-mouse` or `--set-mouse off`).

**Terminal support**, checked with `node scripts/mouse-check.js` (clicks, hover and wheel):

| Terminal                       | Result                                                    |
| ------------------------------ | --------------------------------------------------------- |
| Classic Windows console        | Works: clicks, hover, wheel                               |
| Windows Terminal               | Works: clicks, hover, wheel                               |
| VS Code integrated terminal    | Works: clicks, hover, wheel                               |
| Git Bash (mintty)              | No mouse events, with or without winpty; keyboard works   |
| macOS Terminal                 | Partial: hover and wheel work, clicks register off-centre |
| iTerm2                         | Not recorded yet                                          |
| Linux (GNOME Terminal, others) | Not recorded yet                                          |

Windows Terminal and the classic Windows console both work fully, so mouse support is confirmed as feasible on Windows. The remaining terminals are checked in [Terminal compatibility](#terminal-compatibility).

In macOS Terminal a click only lands on a row when the bottom of the I-beam pointer is over it. The terminal reports whole character cells, not pixels, so the CLI cannot correct this; the `›` hover marker shows which row a click will hit.

The check script draws its items on fixed rows, so its clicks are offset once the window scrolls (seen in the VS Code terminal when the panel is shorter than the script). The list does not rely on fixed rows that may have scrolled: the menus on the alternate screen (see **Alternate screen** below) are drawn from its top row, and the "What next?" list after a script, drawn under its output, asks the terminal for the cursor position (`[6n`) after each drawing and maps each click from the row of its last line.

### Layout and appearance

- [x] **Correct layout:** measure text by its terminal width (`string-width`) so emoji and wide characters never break the header border.
- [x] **Path truncation:** shorten long workspace paths in the middle (`C:/Users/…/projects/web`) instead of cutting off the end [#28](https://github.com/modulane/dev-workspace-cli/issues/28).
- [x] **Alternate screen:** show the menus on the terminal's alternate screen, as `less` and `vim` do, leaving it before a script runs and on every exit path. Resizing the window can then redraw the whole screen, header included, without leaving broken lines or duplicate headers in the scrollback [#60](https://github.com/modulane/dev-workspace-cli/issues/60).
- [x] **Framed header:** the same small box on every screen instead of the 11-line header, with a breadcrumb that starts at the workspace folder (`◆ dev › web-app › build`) set in its top border and the workspace inside. One thin line style and only single-width symbols, so it lines up in every terminal. The list draws it, so it redraws with the list and holds the buttons [#30](https://github.com/modulane/dev-workspace-cli/issues/30).
- [x] **Menu layout:** aligned columns (name, dim details such as the script's command, tags on the right), uppercase group titles, one blank line between the parts of the screen, single-width symbols on actions only, and a full-row hover highlight that falls back to `›` with `NO_COLOR` [#67](https://github.com/modulane/dev-workspace-cli/issues/67).
- [x] **Run result:** show the command before a script's output, and after it `✔ build finished in 4.2s` or `✖ build failed · exit 1 · 0.8s`, with "Run again" and "Back" side by side [#69](https://github.com/modulane/dev-workspace-cli/issues/69).
- [x] **Escape goes back:** with an empty search, Escape returns to the previous screen, or exits from the project list [#70](https://github.com/modulane/dev-workspace-cli/issues/70).
- [x] **Consistent theme:** apply one theme to every prompt, with all colours going through `color()` so `NO_COLOR` and non-TTY output are always respected. Support `FORCE_COLOR` [#31](https://github.com/modulane/dev-workspace-cli/issues/31).
- [x] **Project details:** show package manager, script count and Git branch (if any) next to each project, without slowing down the list (read lazily, cache per session) [#32](https://github.com/modulane/dev-workspace-cli/issues/32).
- [x] **First-run experience:** suggest common folders that exist (`~/dev`, `~/projects`, `~/code`, `~/src`, `~/repos`) as choices, with "Enter another path" as the last option [#33](https://github.com/modulane/dev-workspace-cli/issues/33).
- [x] **First-time setup:** turn the first launch into a short setup screen, drawn like every other menu: the workspace folder (the first-run choices above), then the accent colour used for "you are here" and, faintly, for the header's border: one of twelve, previewed as the cursor moves. Both are saved in `config.json`, and `--set-color` changes the colour later without a reset. Hovered and focused buttons and the `last run` tag take the accent; the Git branch gets a muted colour (the default branch apart) [#72](https://github.com/modulane/dev-workspace-cli/issues/72).
- [x] **Typed paths:** the workspace prompt and `--workspace` accept the forms a shell would normally clean up: `~/projects`, quoted paths (as copied by Explorer's "Copy as path") and, outside Windows, escaped spaces (`my\ projects`). A missing folder is reported with the full path that was checked ([#9](https://github.com/modulane/dev-workspace-cli/issues/9)).
- [x] **Non-interactive guard:** when stdin is not a TTY and no direct-mode arguments are given, exit with a clear message instead of a prompt error [#34](https://github.com/modulane/dev-workspace-cli/issues/34).
- [x] **Coloured `--help`.**

**Done when:** every item above is done, and the interface was checked in Windows Terminal. The checks in the other terminals are the [next milestone](#terminal-compatibility).

## Terminal compatibility

Every screen checked in the terminals people use, on their own schedule: they need macOS and Linux machines, while the code they check is already released.

- [ ] **Mouse in the remaining terminals:** run `node scripts/mouse-check.js` in iTerm2 and a Linux terminal, and record the results in the [terminal support table](#mouse-support) [#26](https://github.com/modulane/dev-workspace-cli/issues/26).
- [ ] **Screens in every terminal:** the main screens, the alternate screen while the window is resized, and the 256-colour accents look correct in each terminal below [#75](https://github.com/modulane/dev-workspace-cli/issues/75).

**Done when:** screenshots of the main screens look correct in Windows Terminal, PowerShell, macOS Terminal, iTerm2 and a Linux terminal, at 80 and 120 columns, with and without `NO_COLOR`, and resizing the window while a menu is open never leaves broken lines or duplicate headers in any of them.

## Bigger workspaces _(released in 0.10.0)_

- [x] **Monorepos:** detect npm, Yarn and pnpm workspaces. A monorepo appears as one project with expandable packages; scripts run in the selected package. Opening it shows a **root** entry for its own scripts and its packages, search looks through all of them, and each package runs with its monorepo's package manager [#36](https://github.com/modulane/dev-workspace-cli/issues/36).
- [x] **Nested discovery:** optional search depth (default 1, maximum 3) for workspaces organised in folders such as `clients/acme/web`, saved with `--set-depth`. It must stop at any folder with a `package.json` and never enter `node_modules`. Projects found deeper are named by their path, and direct mode also finds them by their last part (`dws web`) [#37](https://github.com/modulane/dev-workspace-cli/issues/37).
- [x] **Multiple named workspaces:** save several workspaces (for example `work` and `personal`), switch between them from the menu, and choose one with `--workspace <name>`. Each workspace is saved under a name (its folder name, or one typed when it is added from the menu), and `--list-workspaces` and `--remove-workspace` manage them [#38](https://github.com/modulane/dev-workspace-cli/issues/38).

**Done when:** a 200-project workspace with depth 2 lists in under 500 ms on a typical SSD, measured in a benchmark test.

Met: `test/benchmark.test.js` lists 20 folders of 10 projects each, two levels deep, and fails above 500 ms. It runs with the other tests in CI on every operating system.

## Configuration and scripts

- [ ] **Versioned config schema:** add a `"version"` field and migrate older files automatically, with a backup (`config.json.bak`) before any migration.
- [ ] **Settings:** default package manager, hidden scripts (glob patterns), hidden folders, search depth, and whether to show folders without a `package.json` (currently always shown, dimmed).
- [ ] **`config` command:** `dev-workspace config get|set|list|edit`, so users never have to edit JSON by hand. `edit` opens the file in `$EDITOR` / `%EDITOR%`.
- [ ] **JSON output for automation:** `dev-workspace --list --json` prints projects and scripts as JSON and exits.
- [ ] **Open in VS Code:** an action in a project or package that runs `code .` in its folder, with a hint when the `code` command is missing [#89](https://github.com/modulane/dev-workspace-cli/issues/89).
- [ ] **Run any command:** an action in a project or package that asks for a command and runs it in its folder through the user's shell, as if they had typed `cd` there, with the same result line and **Run again** as a script [#90](https://github.com/modulane/dev-workspace-cli/issues/90).
- [ ] **Update notice:** at most once a day, after a run, mention when a newer version exists on npm. It must never delay startup, and can be disabled with `DEV_WORKSPACE_NO_UPDATE_CHECK=1` and in CI.

**Done when:** every setting is documented, can be set via the `config` command, and is covered by migration tests from every earlier config format.

## Hardening and release candidate

No new features; this milestone makes the existing ones dependable, then freezes the public interface.

### Hardening

- [x] **ESLint** with a recommended config, enforced in `npm run check`.
- [ ] **Type checking:** JSDoc types and `tsc --noEmit --checkJs` in CI, without converting to TypeScript.
- [ ] **End-to-end tests:** spawn the real binary on every operating system in CI, covering flags, direct mode, exit codes and non-TTY behaviour.
- [ ] **Signal handling:** SIGINT and SIGTERM are forwarded correctly, and no child process is left behind when the terminal closes.
- [ ] **Performance budget:** startup to first menu in under 150 ms, checked in CI.
- [x] **Release safety:**
  - [x] publish automatically once CI passes on `main`, in the same workflow run and from the same commit;
  - [x] publish with the npm bundled with Node.js 24, checked to be 11.5.1 or newer, instead of installing `npm@latest`;
  - [x] run `npm run check` (not only `npm test`) before publishing;
  - [x] enforce Conventional Commits on pull request titles, which become the squash-merge commit, so every change is classified for semantic-release;
  - [x] pin every action to a full commit SHA, kept up to date by Dependabot, and audit the workflows with zizmor on pull requests;
  - [x] give the publish job only the permissions it needs, with no git credential on disk and no dependency install scripts while it can request an OIDC token;
  - [x] require the `CI passed` and `Conventional Commit title` checks in the `main` ruleset, so a pull request with failing CI cannot be merged;
  - [x] publish a detailed changelog as the GitHub releases: each entry gets the release notes written in its pull request and the issues it closes ([#49](https://github.com/modulane/dev-workspace-cli/issues/49)). A committed `CHANGELOG.md` is not possible, because the `main` ruleset accepts changes only through pull requests.
- [x] **Contributor files:**
  - [x] `CONTRIBUTING.md` with the development setup, workflow and release process;
  - [x] labels defined in `.github/labels.json`, applied to pull requests from their title, with reviews requested through `CODEOWNERS`;
  - [x] issue forms (bug, feature, question) and a pull request template ([#50](https://github.com/modulane/dev-workspace-cli/issues/50)).

### Release candidate

Once the hardening work is done and CI is green across the full matrix, with coverage at or above 90% and no open `bug` issues:

- [ ] **Interface freeze:** list every public flag, environment variable, config key and exit code in the README, under a "Stability" section. No changes after this point without a deprecation period.
- [ ] **Clean up legacy behaviour:** keep the migration from the configuration location used before 0.3.0, but document it as the only supported upgrade path and drop any other compatibility code added during 0.x.
- [ ] **Documentation:** animated demo (asciinema or GIF) at the top of the README, a full usage guide and a troubleshooting section.
- [ ] **Feedback period:** publish under the `next` npm tag for at least two weeks and fix reported issues.

**Done when:** two weeks pass without new bugs that would require changing the public interface.

## Stable: 1.0.0

The 1.0.0 release promises, under semantic versioning, that these will not change without a major version:

- command-line flags and their meaning;
- environment variables;
- config file keys and location (with automatic migration for any later change);
- exit codes: `0` success, `1` CLI error, and the script's own exit code in direct mode;
- JSON output format from `--list --json`.

---

## Release process notes

- Releases are created automatically by semantic-release when CI passes on `main`, from Conventional Commit messages: `fix:` makes a patch release and `feat:` a minor one. Versions keep counting past 0.9 (0.10.0, 0.11.0, …) until 1.0.0; semantic versioning has no upper limit.
- Because every feature is released on its own, version numbers are not predicted in this document. A milestone's heading records the release that completed it.
- Versions 0.0.0-stage to 0.2.0 were removed from npm on 2026-10-25, and 0.3.0 is deprecated, so 0.4.0 is the oldest supported release. Their git tags and GitHub releases remain as history.
- The real version only exists in git tags and on npm. `package.json` keeps the placeholder `0.0.0-development`, and semantic-release writes the actual version into the package at publish time.
- **Avoid `BREAKING CHANGE` footers and `!` commits before 1.0.0.** semantic-release turns any breaking change into a major release, which would publish 1.0.0 too early. Breaking changes before 1.0.0 should be released as `feat:` and described in the release notes.
- 1.0.0 itself is released by a commit marked as a breaking change once the "Hardening and release candidate" milestone is complete.

## Not planned before 1.0.0

These ideas are out of scope until the core is stable:

- support for languages other than JavaScript (Python, Rust, Make, …);
- running several scripts in parallel or managing background processes;
- a plugin system;
- a graphical interface (see below).

## After 1.0.0: a browser interface

A terminal cannot draw real windows or buttons, so a full graphical interface would run in the browser: `dev-workspace --ui` starts a local server with Node's built-in `http` module and opens the page. It would show project cards, search, buttons to run scripts and their live output. It would use no Electron and need no new dependencies.

A local server that runs commands can be attacked by any website open in the same browser, so these requirements are not optional:

- listen on `127.0.0.1` only, on a random free port;
- require a random token, generated per session and passed in the opened URL, on every request;
- reject requests whose `Host` or `Origin` header is not the server's own address (protection against DNS rebinding and cross-site requests);
- only run scripts that exist in a project's `package.json`, never arbitrary commands sent by the page;
- stop the server when the CLI exits.

Known limit: script output is streamed to the page, but scripts that ask for keyboard input will not work there. Dev servers, builds and tests are unaffected.
