// Parsing JSON files the way npm reads them.
//
// parseJson() is JSON.parse() after removing a leading UTF-8 byte order mark
// (U+FEFF). Windows PowerShell 5.1 and some editors write one at the start of
// a file; JSON.parse() rejects it, while npm ignores it. A U+FEFF anywhere
// else, such as inside a string value, is kept.
//
// Used by config.js, package-managers.js and workspace.js, which keep their
// own error messages.

export function parseJson(text) {
  return JSON.parse(text.startsWith('\uFEFF') ? text.slice(1) : text)
}
