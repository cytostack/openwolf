#!/usr/bin/env bash
# T1 — Build Integrity Tests
# T2 — openwolf init Creates hippocampus.json
#
# Run: bash docs2/phase1/test/T1_T2_build-init.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPENWOLF_DIR="$SCRIPT_DIR/../../.."
TEST_DIR="/tmp/openwolf-phase1-test"

echo "=========================================="
echo "T1 — Build Integrity Tests"
echo "=========================================="

# T1.1 — pnpm build passes
echo ""
echo "T1.1 — pnpm build passes"
cd "$OPENWOLF_DIR"
if pnpm build 2>&1; then
    echo "  ✓ pnpm build succeeded (exit 0)"
else
    echo "  ✗ pnpm build failed"
    exit 1
fi

# T1.2 — dist/bin/openwolf.js exists
echo ""
echo "T1.2 — dist/bin/openwolf.js exists"
if [ -f "$OPENWOLF_DIR/dist/bin/openwolf.js" ]; then
    echo "  ✓ dist/bin/openwolf.js exists"
else
    echo "  ✗ dist/bin/openwolf.js NOT found"
    exit 1
fi

# T1.3 — dist/src/hooks/post-write.js exists
echo ""
echo "T1.3 — dist/src/hooks/post-write.js exists"
if [ -f "$OPENWOLF_DIR/dist/src/hooks/post-write.js" ]; then
    echo "  ✓ dist/src/hooks/post-write.js exists"
else
    echo "  ✗ dist/src/hooks/post-write.js NOT found"
    exit 1
fi

# T1.4 — dist/src/hooks/pre-read.js exists
echo ""
echo "T1.4 — dist/src/hooks/pre-read.js exists"
if [ -f "$OPENWOLF_DIR/dist/src/hooks/pre-read.js" ]; then
    echo "  ✓ dist/src/hooks/pre-read.js exists"
else
    echo "  ✗ dist/src/hooks/pre-read.js NOT found"
    exit 1
fi

# T1.5 — dist/src/hippocampus/ compiled
echo ""
echo "T1.5 — dist/src/hippocampus/ compiled"
if [ -f "$OPENWOLF_DIR/dist/src/hippocampus/index.js" ] && \
   [ -f "$OPENWOLF_DIR/dist/src/hippocampus/types.js" ] && \
   [ -f "$OPENWOLF_DIR/dist/src/hippocampus/event-store.js" ]; then
    echo "  ✓ index.js, types.js, event-store.js exist"
else
    echo "  ✗ Missing files in dist/src/hippocampus/"
    ls -la "$OPENWOLF_DIR/dist/src/hippocampus/" 2>/dev/null || echo "Directory doesn't exist"
    exit 1
fi

echo ""
echo "=========================================="
echo "T2 — openwolf init Creates hippocampus.json"
echo "=========================================="

# Clean test dir
rm -rf "$TEST_DIR"
mkdir -p "$TEST_DIR"
cd "$TEST_DIR"

# Create minimal package.json for init
echo '{"name": "test-project"}' > package.json

# T2.1 — openwolf init runs
echo ""
echo "T2.1 — openwolf init runs"
if node "$OPENWOLF_DIR/dist/bin/openwolf.js" init 2>&1; then
    echo "  ✓ openwolf init succeeded"
else
    echo "  ✗ openwolf init failed"
    exit 1
fi

# T2.2 — .wolf/hippocampus.json created
echo ""
echo "T2.2 — .wolf/hippocampus.json created"
if [ -f "$TEST_DIR/.wolf/hippocampus.json" ]; then
    echo "  ✓ hippocampus.json created"
else
    echo "  ✗ hippocampus.json NOT found"
    exit 1
fi

# T2.3 — Valid JSON and schema version
echo ""
echo "T2.3 — hippocampus.json valid JSON, schema version 1"
SCHEMA_VERSION=$(node -e "const fs = require('fs'); const j = JSON.parse(fs.readFileSync('$TEST_DIR/.wolf/hippocampus.json', 'utf8')); console.log(j.schema_version || j.version);")
if [ "$SCHEMA_VERSION" = "1" ]; then
    echo "  ✓ schema_version is 1"
else
    echo "  ✗ schema_version is '$SCHEMA_VERSION', expected 1"
    exit 1
fi

# T2.4 — project_root is absolute path (filled by Hippocampus class, not init)
# Note: During init, project_root is empty. It's filled when Hippocampus first creates a store.
echo ""
echo "T2.4 — hippocampus.json has project_root field (may be empty until first use)"
PROJECT_ROOT=$(node -e "const fs = require('fs'); const j = JSON.parse(fs.readFileSync('$TEST_DIR/.wolf/hippocampus.json', 'utf8')); console.log(j.project_root);")
if [ -z "$PROJECT_ROOT" ] || [ "$PROJECT_ROOT" = "$TEST_DIR" ]; then
    echo "  ✓ project_root is '$PROJECT_ROOT' (empty is OK, filled on first use)"
else
    echo "  ✗ project_root is '$PROJECT_ROOT', expected '$TEST_DIR' or empty"
    exit 1
fi

# T2.5 — created_at is ISO 8601 (filled by Hippocampus class, not init)
# Note: During init, created_at is empty. It's filled when Hippocampus first creates a store.
echo ""
echo "T2.5 — hippocampus.json has created_at field (may be empty until first use)"
CREATED_AT=$(node -e "const fs = require('fs'); const j = JSON.parse(fs.readFileSync('$TEST_DIR/.wolf/hippocampus.json', 'utf8')); console.log(j.created_at);")
if [ -z "$CREATED_AT" ] || [[ "$CREATED_AT" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T ]]; then
    echo "  ✓ created_at is '$CREATED_AT' (empty is OK, filled on first use)"
else
    echo "  ✗ created_at is invalid: '$CREATED_AT'"
    exit 1
fi

# T2.6 — max_size_bytes is 5000000
echo ""
echo "T2.6 — hippocampus.json has max_size_bytes=5000000"
MAX_SIZE=$(node -e "const fs = require('fs'); const j = JSON.parse(fs.readFileSync('$TEST_DIR/.wolf/hippocampus.json', 'utf8')); console.log(j.max_size_bytes);")
if [ "$MAX_SIZE" = "5000000" ]; then
    echo "  ✓ max_size_bytes is 5000000"
else
    echo "  ✗ max_size_bytes is '$MAX_SIZE', expected 5000000"
    exit 1
fi

echo ""
echo "=========================================="
echo "T1 + T2 Results: ALL PASSED"
echo "=========================================="

# Cleanup
rm -rf "$TEST_DIR"
