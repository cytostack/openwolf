import { test, describe } from "node:test";
import * as assert from "node:assert";

import { shouldSuggestFilter } from "../src/hooks/bash-filter.ts";

describe("shouldSuggestFilter positives", () => {
  const positives = [
    "npm test",
    "npm test -- --coverage",
    "pnpm test",
    "pnpm build",
    "yarn test",
    "npx jest",
    "npx vitest run",
    "pytest",
    "pytest tests/unit",
    "python -m pytest tests/",
    "go test ./...",
    "cargo test",
    "cargo build --release",
    "tsc",
    "tsc --noEmit",
    "make test",
    "./gradlew build",
    "mvn test",
    "  npm test  ",
  ];
  for (const cmd of positives) {
    test(`suggests for: ${JSON.stringify(cmd)}`, () => {
      assert.strictEqual(shouldSuggestFilter(cmd), true);
    });
  }
});

describe("shouldSuggestFilter negatives (must NEVER fire)", () => {
  const negatives = [
    // Already shaped output
    "npm test | tail -50",
    "npm test > out.log 2>&1",
    "pytest -q",
    "npm test --silent",
    "go test ./... | grep FAIL",
    "cargo test 2>&1 | head -100",
    "npm test && echo done",
    "npm test; echo done",
    "pytest `ls tests`",
    "npm test $(get_args)",
    "tail -f log.txt",
    "head -5 README.md",
    // Prefix lookalikes
    "npm testify",
    "pytest-watch",
    "gotest",
    "tscribe",
    "makefile-lint",
    "npm run build:watch --verbose | cat",
    // Unrelated commands
    "git status",
    "ls -la",
    "node script.js",
    "npm install",
    "npm run dev",
    "echo npm test",
    "",
    "   ",
    // Interactive or destructive things we must not touch
    "npm test -- --watch > /dev/null",
    "rm -rf dist && npm run build",
  ];
  for (const cmd of negatives) {
    test(`stays silent for: ${JSON.stringify(cmd)}`, () => {
      assert.strictEqual(shouldSuggestFilter(cmd), false);
    });
  }
});
