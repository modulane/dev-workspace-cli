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
| Fast navigation                 | Complete, in the next release             | Fuzzy search, recent items, direct mode, script arguments                 |
| A polished interface            | Planned                                   | Mouse support, correct layout, themes, project details, first run         |
| Bigger workspaces               | Planned                                   | Monorepos, nested projects, multiple named workspaces                     |
| Configuration and scripts       | Planned                                   | Versioned config schema, `config` command, JSON output                    |
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

## Fast navigation

The CLI should be faster than typing `cd` and `npm run`.

- [x] **Own list prompt:** replace Inquirer's `select` with a small list component that the CLI controls fully: rendering, scrolling, key handling and the row position of every item. It is the base for fuzzy search here and for mouse support in [A polished interface](#a-polished-interface).
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

## A polished interface

The CLI should look clean, and stay correct, in every terminal.

### Mouse support

Terminals can report mouse events as escape sequences (SGR mouse mode, `\x1b[?1000h` and `\x1b[?1006h`). Each click arrives on stdin with its row and column, which the list prompt from [Fast navigation](#fast-navigation) maps to the item drawn there.

- [ ] Click an item to select it; click the selected item again (or double-click) to open it. Terminals send a double-click as two separate presses, so clicks are ignored for about 300 ms after an item opens; otherwise the second press lands on the next screen.
- [ ] Hover highlights the item under the pointer, in terminals that report motion.
- [ ] The scroll wheel moves through long lists.
- [ ] Clickable "Back" and "Exit" entries on every screen.
- [ ] Mouse reporting is switched on only while a menu is shown. It is switched off before a script starts, and on every exit path: normal exit, Ctrl+C, errors and crashes. A terminal must never be left in mouse mode.
- [ ] Turned off automatically in terminals that do not report mouse events. Users can also disable it with `--no-mouse` or a setting, because it replaces the terminal's normal text selection while a menu is open (Shift or Option + drag still selects text).
- [ ] Keyboard navigation keeps working exactly as before; the mouse is an addition, never a requirement.

**Terminal support**, checked with `node scripts/mouse-check.js` (clicks, hover and wheel):

| Terminal                       | Result                                                    |
| ------------------------------ | --------------------------------------------------------- |
| Classic Windows console        | Works: clicks, hover, wheel                               |
| Windows Terminal               | Not recorded yet                                          |
| VS Code integrated terminal    | Not recorded yet                                          |
| macOS Terminal                 | Partial: hover and wheel work, clicks register off-centre |
| iTerm2                         | Not recorded yet                                          |
| Linux (GNOME Terminal, others) | Not recorded yet                                          |

The classic Windows console was the riskiest case, so mouse support is confirmed as feasible. The remaining terminals must be checked before this milestone is complete.

In macOS Terminal a click only lands on a row when the bottom of the I-beam pointer is over it. The terminal reports whole character cells, not pixels, so the CLI cannot correct this; the hover highlight shows which row a click will hit.

### Layout and appearance

- [x] **Correct layout:** measure text by its terminal width (`string-width`) so emoji and wide characters never break the header border.
- [ ] **Path truncation:** shorten long workspace paths in the middle (`C:/Users/…/projects/web`) instead of cutting off the end.
- [ ] **Alternate screen:** show the menus on the terminal's alternate screen, as `less` and `vim` do, leaving it before a script runs and on every exit path. Resizing the window can then redraw the whole screen, header included, without leaving broken lines or duplicate headers in the scrollback.
- [ ] **Compact header:** a one-line header by default after the first screen; the large header only on the main screen.
- [ ] **Consistent theme:** apply one theme to every prompt, with all colours going through `color()` so `NO_COLOR` and non-TTY output are always respected. Support `FORCE_COLOR`.
- [ ] **Project details:** show package manager, script count and Git branch (if any) next to each project, without slowing down the list (read lazily, cache per session).
- [ ] **First-run experience:** suggest common folders that exist (`~/dev`, `~/projects`, `~/code`, `~/src`, `~/repos`) as choices, with "Enter another path" as the last option.
- [x] **Typed paths:** the workspace prompt and `--workspace` accept the forms a shell would normally clean up: `~/projects`, quoted paths (as copied by Explorer's "Copy as path") and, outside Windows, escaped spaces (`my\ projects`). A missing folder is reported with the full path that was checked ([#9](https://github.com/modulane/dev-workspace-cli/issues/9)).
- [ ] **Non-interactive guard:** when stdin is not a TTY and no direct-mode arguments are given, exit with a clear message instead of a prompt error.
- [x] **Coloured `--help`.**

**Done when:** screenshots of the main screens look correct in Windows Terminal, PowerShell, macOS Terminal, iTerm2 and a Linux terminal, at 80 and 120 columns, with and without `NO_COLOR`.

## Bigger workspaces

- [ ] **Monorepos:** detect npm, Yarn and pnpm workspaces. A monorepo appears as one project with expandable packages; scripts run in the selected package.
- [ ] **Nested discovery:** optional search depth (default 1, maximum 3) for workspaces organised in folders such as `clients/acme/web`. It must stop at any folder with a `package.json` and never enter `node_modules`.
- [ ] **Multiple named workspaces:** save several workspaces (for example `work` and `personal`), switch between them from the menu, and choose one with `--workspace <name>`.

**Done when:** a 200-project workspace with depth 2 lists in under 500 ms on a typical SSD, measured in a benchmark test.

## Configuration and scripts

- [ ] **Versioned config schema:** add a `"version"` field and migrate older files automatically, with a backup (`config.json.bak`) before any migration.
- [ ] **Settings:** default package manager, hidden scripts (glob patterns), hidden folders, search depth, and whether to show folders without a `package.json` (currently always shown, dimmed).
- [ ] **`config` command:** `dev-workspace config get|set|list|edit`, so users never have to edit JSON by hand. `edit` opens the file in `$EDITOR` / `%EDITOR%`.
- [ ] **JSON output for automation:** `dev-workspace --list --json` prints projects and scripts as JSON and exits.
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
- [ ] **Release safety:**
  - [x] publish automatically once CI passes on `main`, in the same workflow run and from the same commit;
  - [x] publish with the npm bundled with Node.js 24, checked to be 11.5.1 or newer, instead of installing `npm@latest`;
  - [x] run `npm run check` (not only `npm test`) before publishing;
  - [x] enforce Conventional Commits on pull request titles, which become the squash-merge commit, so every change is classified for semantic-release;
  - [x] pin every action to a full commit SHA, kept up to date by Dependabot, and audit the workflows with zizmor on pull requests;
  - [x] give the publish job only the permissions it needs, with no git credential on disk and no dependency install scripts while it can request an OIDC token;
  - [x] require the `CI passed` and `Conventional Commit title` checks in the `main` ruleset, so a pull request with failing CI cannot be merged;
  - publish a `CHANGELOG.md` with `@semantic-release/changelog`.
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
