---
description: Layered security audit of the current project (dependencies → secrets → injection → authz → report)
argument-hint: [path or scope, e.g. src/api — omit for whole project]
---

Perform a layered security audit of: $ARGUMENTS (if empty: the whole project).

Use `.wolf/anatomy.md` to target files instead of scanning blindly, and check
`.wolf/buglog.json` for previously found security issues before re-reporting them.

Work through the layers in order. For each, report findings before moving on:

## Layer 1 — Dependencies
Run the ecosystem's audit tool (`npm audit` / `pnpm audit` / `pip-audit` / `cargo audit` …).
Flag known-vulnerable versions and unmaintained packages that handle untrusted input.

## Layer 2 — Secrets
Search for hardcoded credentials: API keys, tokens, passwords, connection strings,
private keys. Check committed env files, config files, and test fixtures. Verify
`.gitignore` covers secret-bearing files (.env*, *.pem, *.key, credentials*).

## Layer 3 — Injection surfaces
Find every place external input reaches an interpreter: shell commands built by string
interpolation (exec/execSync with template strings), SQL string concatenation, HTML
injection/XSS sinks, path traversal (user input joined into fs paths), deserialization
of untrusted data, SSRF (user-controlled URLs fetched server-side).

## Layer 4 — AuthN / AuthZ
Map endpoints and privileged operations. Check: missing auth middleware, IDOR (object
IDs without ownership checks), privilege escalation paths, session handling, CORS and
CSRF posture, servers bound to 0.0.0.0 without auth.

## Layer 5 — Report
Produce a severity-ranked table (Critical/High/Medium/Low): finding, file:line, attack
scenario, concrete fix. Log confirmed vulnerabilities to `.wolf/buglog.json` with tag
"security". Offer to fix Critical and High items immediately.

Rules: verify each finding against the actual code before reporting (no
pattern-match-only findings); prefer minimal, targeted fixes; never weaken existing
security to silence a warning.
