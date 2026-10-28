#!/usr/bin/env node

import { startCli } from './lib/cli.js'

// A script run directly (`dev-workspace <project> <script>`) passes on its
// exit code.
startCli()
  .then(code => {
    if (code !== undefined) process.exitCode = code
  })
  .catch(error => {
    console.error(`\n  CLI error: ${error.message}`)
    process.exitCode = 1
  })
