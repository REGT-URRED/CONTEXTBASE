#!/usr/bin/env node

import { cli } from '../src/cli.js';

cli().catch((err) => {
  console.error('\x1b[31m[ContextBase Error]:\x1b[0m', err.message);
  process.exit(Number.isInteger(err.exitCode) ? err.exitCode : 1);
});
