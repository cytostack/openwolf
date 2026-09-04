#!/usr/bin/env node

const major = parseInt(process.versions.node.split(".")[0], 10);
if (major < 20) {
  console.error(`OpenWolf requires Node.js 20 or higher. You are running ${process.version}.`);
  process.exit(1);
}

// Dynamic import so the version guard actually runs first: a static import is
// hoisted and evaluates the whole CLI dependency graph before the check,
// crashing old Node with a cryptic syntax error instead of the message above.
const { createProgram } = await import("../src/cli/index.js");

const program = createProgram();
program.parse(process.argv);
