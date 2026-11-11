// Reading JSON the way npm does, ignoring a leading byte order mark.
// Used by config.js, package-managers.js, state.js and workspace.js.

// JSON.parse() after removing a leading U+FEFF, which Windows PowerShell 5.1
// and some editors write and npm ignores.
export function parseJson(text) {
  return JSON.parse(text.startsWith('\uFEFF') ? text.slice(1) : text)
}
