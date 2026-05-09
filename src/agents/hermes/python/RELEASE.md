# Releasing openwolf-hermes

The Python plugin under `src/agents/hermes/python/` ships to PyPI separately
from the OpenWolf npm package. Versions track the plugin's own changelog,
not OpenWolf's main version.

## Auth: Trusted Publishing (OIDC, recommended)

The workflow uses PyPI's Trusted Publishing — no long-lived API tokens, no
secret rotation. PyPI verifies a short-lived OIDC token issued by GitHub
for the exact workflow + environment combination registered as a
publisher.

### One-time PyPI setup

For the **first** release (project doesn't exist yet on PyPI), use the
**Pending Publisher** form at
https://pypi.org/manage/account/publishing/:

```
PyPI Project Name:  openwolf-hermes
Owner:              ChasLui
Repository name:    openwolf
Workflow name:      publish-hermes-plugin.yml
Environment name:   pypi
```

Pending publishers auto-promote to a regular publisher when the first
matching upload arrives.

For **subsequent** publishers (or after the project exists), use the
regular "Add a new publisher" form — same fields.

### One-time GitHub setup

In `ChasLui/openwolf` repo Settings → Environments → **New environment**
named `pypi`. Optional: add yourself as a required reviewer to
two-person-rule the publish step.

### Release flow

```bash
cd src/agents/hermes/python

# 1. Bump version in pyproject.toml + __init__.py __version__ (must match)
sed -i '' 's/version = "0.1.0"/version = "0.2.0"/' pyproject.toml
sed -i '' 's/__version__ = "0.1.0"/__version__ = "0.2.0"/' src/openwolf_hermes/__init__.py

# 2. Verify build locally
python -m pip install --upgrade build twine
python -m build && python -m twine check dist/*

# 3. Commit + tag + push
git add pyproject.toml src/openwolf_hermes/__init__.py
git commit -m "chore(openwolf-hermes): bump to 0.2.0"
git tag openwolf-hermes-v0.2.0
git push origin dev openwolf-hermes-v0.2.0

# 4. GitHub Actions runs publish-hermes-plugin.yml automatically.
#    Watch: gh run watch --repo ChasLui/openwolf
```

## Fallback: API token

If Trusted Publishing is unavailable (PyPI down, OIDC issue, urgent
release), temporarily switch the workflow to API token auth:

1. Generate a token at https://pypi.org/manage/account/token/ scoped to
   `openwolf-hermes` (or account-wide for very first publish).
2. `printf '%s' '<token>' | gh secret set PYPI_API_TOKEN --repo ChasLui/openwolf`
3. In the workflow's `publish` job, replace
   `permissions: id-token: write` and `environment: ...` with
   `with: password: ${{ secrets.PYPI_API_TOKEN }}` on the
   `pypa/gh-action-pypi-publish` step.
4. After release, revert workflow + `gh secret delete PYPI_API_TOKEN`.

Never leave a long-lived API token enabled when Trusted Publishing works.

## Release flow

```bash
cd src/agents/hermes/python

# 1. Bump version in pyproject.toml + __init__.py __version__
#    (must match — both files)
#    For 0.1.0 → 0.2.0:
sed -i '' 's/version = "0.1.0"/version = "0.2.0"/' pyproject.toml
sed -i '' 's/__version__ = "0.1.0"/__version__ = "0.2.0"/' src/openwolf_hermes/__init__.py

# 2. Verify build works locally
python -m pip install --upgrade build twine
python -m build
python -m twine check dist/*

# 3. Commit + tag
git add pyproject.toml src/openwolf_hermes/__init__.py
git commit -m "chore(openwolf-hermes): bump to 0.2.0"
git tag openwolf-hermes-v0.2.0
git push origin dev openwolf-hermes-v0.2.0

# 4. GitHub Actions runs publish-hermes-plugin.yml automatically.
#    Watch: https://github.com/ChasLui/openwolf/actions
```

## Dry-run (build without uploading)

`gh workflow run publish-hermes-plugin.yml -f dry_run=true`

Or push to a branch — only tag pushes trigger upload.

## Yanking a bad release

```bash
# Yank from PyPI (keeps version reserved, blocks new installs):
twine yank openwolf-hermes==X.Y.Z --reason "broken: <reason>"

# Or via PyPI web UI: project page → Manage → "Yank release".
```

Never delete a published version — it breaks anyone who depends on it.
Yank instead.

## Why dev-install was used during Phase 3

Phase 3 (commit `c08bb69`) ships the plugin source in the OpenWolf fork
itself. The HermesAdapter does `uv pip install -e <fork>/src/agents/hermes/python/`
— editable install from local checkout. This is intentional during
pre-PyPI alpha so:

- Plugin code can iterate without re-publishing
- The fork is self-contained for local testing
- No external account dependencies block adoption

Once on PyPI, HermesAdapter should switch to plain `uv pip install
openwolf-hermes` (no `-e`, no path arg). That refactor is part of Phase 4b
and lands when the first PyPI release is published.
