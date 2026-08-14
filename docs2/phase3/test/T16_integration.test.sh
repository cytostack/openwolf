#!/bin/bash
# T16 — Phase 3 Integration Tests
# Tests for consolidation daemon wiring and neocortex initialization

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
DIST_ROOT="$PROJECT_ROOT/dist"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

passed=0
failed=0

assert() {
  local name="$1"
  local condition="$2"
  if [ "$condition" = "true" ] || [ "$condition" = "0" ]; then
    echo -e "  ${GREEN}✓${NC} $name"
    passed=$((passed + 1))
  else
    echo -e "  ${RED}✗${NC} $name"
    failed=$((failed + 1))
  fi
}

echo ""
echo "=== T16 — Phase 3 Integration Tests ==="
echo ""

# Create temp test project
TEST_DIR=$(mktemp -d)
trap "rm -rf $TEST_DIR" EXIT

echo "Test directory: $TEST_DIR"
echo ""

# T16.1 — Build passes with consolidation module
echo "  T16.1 — Build includes consolidation module"
if [ -f "$DIST_ROOT/src/hippocampus/consolidation.js" ]; then
  assert "consolidation.js exists in dist" "true"
else
  assert "consolidation.js exists in dist" "false"
fi

# T16.2 — Neocortex template exists
echo ""
echo "  T16.2 — Neocortex template exists"
if [ -f "$PROJECT_ROOT/src/templates/neocortex.json" ]; then
  assert "neocortex.json template exists" "true"
else
  assert "neocortex.json template exists" "false"
fi

# T16.3 — init creates neocortex.json
echo ""
echo "  T16.3 — init creates neocortex.json"
cd "$TEST_DIR"
"$PROJECT_ROOT/dist/bin/openwolf.js" init > /dev/null 2>&1 || true
if [ -f "$TEST_DIR/.wolf/neocortex.json" ]; then
  assert "neocortex.json created by init" "true"
else
  assert "neocortex.json created by init" "false"
fi

# T16.4 — Neocortex has correct structure
echo ""
echo "  T16.4 — Neocortex has correct structure"
if [ -f "$TEST_DIR/.wolf/neocortex.json" ]; then
  VERSION=$(node -e "const d=require('./.wolf/neocortex.json'); console.log(d.version)")
  if [ "$VERSION" = "1" ]; then
    assert "neocortex.json version is 1" "true"
  else
    assert "neocortex.json version is 1" "false"
  fi

  EVENTS=$(node -e "const d=require('./.wolf/neocortex.json'); console.log(Array.isArray(d.events))")
  if [ "$EVENTS" = "true" ]; then
    assert "neocortex.json events is array" "true"
  else
    assert "neocortex.json events is array" "false"
  fi
else
  assert "neocortex.json exists" "false"
fi

# T16.5 — Cron manifest includes hippocampus consolidation
echo ""
echo "  T16.5 — Cron manifest includes hippocampus consolidation"
if [ -f "$TEST_DIR/.wolf/cron-manifest.json" ]; then
  if node -e "const m=require('./.wolf/cron-manifest.json'); console.log(m.tasks.some(t=>t.id==='hippocampus-consolidation'))" | grep -q "true"; then
    assert "hippocampus-consolidation task in manifest" "true"
  else
    assert "hippocampus-consolidation task in manifest" "false"
  fi
else
  assert "cron-manifest.json exists" "false"
fi

# T16.6 — Hippocampus has consolidate method
echo ""
echo "  T16.6 — Hippocampus has consolidate method"
if node -e "
const { Hippocampus } = require('$DIST_ROOT/src/hippocampus/index.js');
const h = new Hippocampus('$TEST_DIR');
console.log(typeof h.consolidate === 'function' ? 'true' : 'false');
" 2>/dev/null | grep -q "true"; then
  assert "Hippocampus.consolidate() method exists" "true"
else
  assert "Hippocampus.consolidate() method exists" "false"
fi

# T16.7 — Hippocampus has getLongTermMemory method
echo ""
echo "  T16.7 — Hippocampus has getLongTermMemory method"
if node -e "
const { Hippocampus } = require('$DIST_ROOT/src/hippocampus/index.js');
const h = new Hippocampus('$TEST_DIR');
console.log(typeof h.getLongTermMemory === 'function' ? 'true' : 'false');
" 2>/dev/null | grep -q "true"; then
  assert "Hippocampus.getLongTermMemory() method exists" "true"
else
  assert "Hippocampus.getLongTermMemory() method exists" "false"
fi

# T16.8 — Hippocampus has getNeocortexStats method
echo ""
echo "  T16.8 — Hippocampus has getNeocortexStats method"
if node -e "
const { Hippocampus } = require('$DIST_ROOT/src/hippocampus/index.js');
const h = new Hippocampus('$TEST_DIR');
console.log(typeof h.getNeocortexStats === 'function' ? 'true' : 'false');
" 2>/dev/null | grep -q "true"; then
  assert "Hippocampus.getNeocortexStats() method exists" "true"
else
  assert "Hippocampus.getNeocortexStats() method exists" "false"
fi

# T16.9 — Hippocampus has neocortexExists method
echo ""
echo "  T16.9 — Hippocampus has neocortexExists method"
if node -e "
const { Hippocampus } = require('$DIST_ROOT/src/hippocampus/index.js');
const h = new Hippocampus('$TEST_DIR');
console.log(typeof h.neocortexExists === 'function' ? 'true' : 'false');
" 2>/dev/null | grep -q "true"; then
  assert "Hippocampus.neocortexExists() method exists" "true"
else
  assert "Hippocampus.neocortexExists() method exists" "false"
fi

# T16.10 — Consolidation creates neocortex if missing
echo ""
echo "  T16.10 — Consolidation creates neocortex if missing"
cd "$TEST_DIR"
node -e "
const { Hippocampus } = require('$DIST_ROOT/src/hippocampus/index.js');
const h = new Hippocampus('$TEST_DIR');
h.consolidate();
console.log(h.neocortexExists() ? 'true' : 'false');
" 2>/dev/null | grep -q "true" && assert "consolidate() creates neocortex" "true" || assert "consolidate() creates neocortex" "false"

# T16.11 — Daemon cron-engine handles consolidate_hippocampus action
echo ""
echo "  T16.11 — Cron engine handles consolidate_hippocampus action"
if node -e "
const fs = require('fs');
const cronEnginePath = '$DIST_ROOT/src/daemon/cron-engine.js';
const content = fs.readFileSync(cronEnginePath, 'utf-8');
console.log(content.includes('consolidate_hippocampus') ? 'true' : 'false');
" 2>/dev/null | grep -q "true"; then
  assert "cron-engine.js handles consolidate_hippocampus" "true"
else
  assert "cron-engine.js handles consolidate_hippocampus" "false"
fi

# Summary
echo ""
echo "========================================="
echo -e "T16 Results: ${GREEN}${passed} passed${NC}, ${RED}${failed} failed${NC}"
echo "========================================="

if [ $failed -gt 0 ]; then
  exit 1
fi
exit 0
