#!/usr/bin/env node
// Copy assets/hook-runner.vbs → dist/assets/hook-runner.vbs as part of
// the build. The VBS is resolved at runtime by src/utils/hook-command.ts
// relative to the compiled module location.
//
// Kept tiny and ESM so it runs under the same Node we use for the rest
// of the build pipeline without a transpile step.

import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '..', 'assets', 'hook-runner.vbs');
const dst = resolve(here, '..', 'dist', 'assets', 'hook-runner.vbs');

mkdirSync(dirname(dst), { recursive: true });
copyFileSync(src, dst);
console.log(`copied: ${src} → ${dst}`);
