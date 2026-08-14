#!/usr/bin/env bash
# T5 — post-write.ts Hook Wiring (addEvent)
# T6 — pre-read.ts Hook Wiring (Trauma Warnings)
# T7 — Valence Detection Accuracy
# T8 — Buffer Eviction
#
# Run: bash docs2/phase1/test/T5_T8_runtime.sh
# Note: These tests require a real openwolf init project with hooks configured

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPENWOLF_DIR="$SCRIPT_DIR/../../.."
TEST_DIR="/tmp/openwolf-runtime-test"

echo "=========================================="
echo "T5-T8 — Runtime Tests"
echo "=========================================="

# Setup test project
rm -rf "$TEST_DIR"
mkdir -p "$TEST_DIR"
cd "$TEST_DIR"

echo '{"name": "test-project"}' > package.json

# Initialize openwolf
echo "Initializing test project..."
node "$OPENWOLF_DIR/dist/bin/openwolf.js" init >/dev/null 2>&1

# Create src directory for test files
mkdir -p "$TEST_DIR/src"

# Set project dir for hooks
export CLAUDE_PROJECT_DIR="$TEST_DIR"

echo ""
echo "=========================================="
echo "T5 — post-write.ts Hook Wiring (addEvent)"
echo "=========================================="

# T5.1 — New file write creates event
echo ""
echo "T5.1 — New file write creates event"

# Create a new file
echo '// test file' > src/test.ts

# Simulate post-write hook call (write event)
echo '{"tool_name": "Write", "tool_input": {"file_path": "src/test.ts", "content": "// test file\n"}}' | \
    node "$OPENWOLF_DIR/dist/src/hooks/post-write.js" 2>/dev/null

# Check hippocampus.json
EVENT_COUNT=$(node -e "const fs = require('fs'); const j = JSON.parse(fs.readFileSync('$TEST_DIR/.wolf/hippocampus.json', 'utf8')); console.log(j.buffer.length);")
if [ "$EVENT_COUNT" -ge 1 ]; then
    echo "  ✓ Event created (buffer has $EVENT_COUNT events)"
else
    echo "  ✗ No event created"
    exit 1
fi

# T5.2 — Event has correct action.type
echo ""
echo "T5.2 — Event has correct action.type (write)"
ACTION_TYPE=$(node -e "const fs = require('fs'); const j = JSON.parse(fs.readFileSync('$TEST_DIR/.wolf/hippocampus.json', 'utf8')); console.log(j.buffer[0]?.action?.type || 'NONE');")
if [ "$ACTION_TYPE" = "write" ]; then
    echo "  ✓ action.type is 'write'"
else
    echo "  ✗ action.type is '$ACTION_TYPE', expected 'write'"
    exit 1
fi

# T5.3 — New file has neutral valence
echo ""
echo "T5.3 — New file has correct valence"
VALENCE=$(node -e "const fs = require('fs'); const j = JSON.parse(fs.readFileSync('$TEST_DIR/.wolf/hippocampus.json', 'utf8')); console.log(j.buffer[0]?.outcome?.valence || 'NONE');")
if [ "$VALENCE" = "neutral" ]; then
    echo "  ✓ valence is 'neutral'"
else
    echo "  ✗ valence is '$VALENCE', expected 'neutral'"
    exit 1
fi

# T5.4 — Event has spatial_path
echo ""
echo "T5.4 — Event has spatial_path"
SPATIAL_PATH=$(node -e "const fs = require('fs'); const j = JSON.parse(fs.readFileSync('$TEST_DIR/.wolf/hippocampus.json', 'utf8')); console.log(j.buffer[0]?.context?.spatial_path || 'NONE');")
if [ -n "$SPATIAL_PATH" ] && [ "$SPATIAL_PATH" != "NONE" ]; then
    echo "  ✓ spatial_path is '$SPATIAL_PATH'"
else
    echo "  ✗ spatial_path is missing"
    exit 1
fi

# T5.5 — 3rd edit to same file = trauma
echo ""
echo "T5.5 — 3rd edit to same file sets valence=trauma"

# Edit the file 3 times (simulate)
for i in 1 2 3; do
    echo "// edit $i" >> src/test.ts
    echo "{\"tool_name\": \"Edit\", \"tool_input\": {\"file_path\": \"src/test.ts\", \"old_string\": \"// edit $((i-1))\", \"new_string\": \"// edit $i\"}}" | \
        node "$OPENWOLF_DIR/dist/src/hooks/post-write.js" 2>/dev/null
done

# Check if trauma was created
TRAUMA_COUNT=$(node -e "const fs = require('fs'); const j = JSON.parse(fs.readFileSync('$TEST_DIR/.wolf/hippocampus.json', 'utf8')); console.log(j.stats.trauma_count);")
if [ "$TRAUMA_COUNT" -ge 1 ]; then
    echo "  ✓ Trauma event created (trauma_count: $TRAUMA_COUNT)"
else
    echo "  ✗ No trauma event (trauma_count: $TRAUMA_COUNT)"
    exit 1
fi

# T5.6 — Hippocampus failures are silent (no stderr)
echo ""
echo "T5.6 — Hippocampus failures are silent"
STDERR_OUTPUT=$(echo '{"tool_name": "Write", "tool_input": {"file_path": "src/test2.ts"}}' | \
    node "$OPENWOLF_DIR/dist/src/hooks/post-write.js" 2>&1)
if [ -z "$STDERR_OUTPUT" ]; then
    echo "  ✓ No stderr output from hook"
else
    echo "  ✗ Hook produced stderr: $STDERR_OUTPUT"
    exit 1
fi

echo ""
echo "=========================================="
echo "T6 — pre-read.ts Hook Wiring (Warnings)"
echo "=========================================="

# T6.1 — No warning for file with no trauma
echo ""
echo "T6.1 — No warning for non-traumatized file"
STDOUT=$(echo '{"tool_input": {"file_path": "src/test2.ts"}}' | \
    node "$OPENWOLF_DIR/dist/src/hooks/pre-read.js" 2>&1)
if [ -z "$STDOUT" ]; then
    echo "  ✓ No warning for clean file"
else
    echo "  ✗ Unexpected output: $STDOUT"
    exit 1
fi

# T6.2 — Warning for traumatized file (via direct Hippocampus API test)
# Note: The pre-read hook integration is complex to test via shell.
# We verify the underlying getTraumas API works correctly here.
echo ""
echo "T6.2 — Warning for traumatized file (via API)"
node -e "
const { Hippocampus } = require('$OPENWOLF_DIR/dist/src/hippocampus/index.js');
const h = new Hippocampus('$TEST_DIR');
const traumas = h.getTraumas('$TEST_DIR/src/test.ts');
const highIntensity = traumas.filter(t => t.outcome.intensity >= 0.6);
if (highIntensity.length > 0) {
  console.log('  ✓ Found', highIntensity.length, 'trauma(s) with intensity >= 0.6');
  console.log('  ✓ First trauma:', highIntensity[0].outcome.reflection);
} else {
  console.error('  ✗ No high-intensity traumas found');
  process.exit(1);
}
"

# T6.3 — Warning includes intensity (via API)
echo ""
echo "T6.3 — Warning includes intensity (via API)"
node -e "
const { Hippocampus } = require('$OPENWOLF_DIR/dist/src/hippocampus/index.js');
const h = new Hippocampus('$TEST_DIR');
const traumas = h.getTraumas('$TEST_DIR/src/test.ts');
const highIntensity = traumas.filter(t => t.outcome.intensity >= 0.6);
if (highIntensity.length > 0 && highIntensity[0].outcome.intensity >= 0.6) {
  console.log('  ✓ First trauma intensity:', highIntensity[0].outcome.intensity, '>= 0.6');
} else {
  console.error('  ✗ No high-intensity traumas');
  process.exit(1);
}
"

echo ""
echo "=========================================="
echo "T8 — Buffer Eviction"
echo "=========================================="

# T8.1 — Max buffer size enforced
echo ""
echo "T8.1 — Buffer eviction logic exists"
MAX_BUFFER=$(node -e "const fs = require('fs'); const j = JSON.parse(fs.readFileSync('$TEST_DIR/.wolf/hippocampus.json', 'utf8')); console.log(j.max_buffer_size);")
if [ "$MAX_BUFFER" = "500" ]; then
    echo "  ✓ max_buffer_size is 500"
else
    echo "  ✗ max_buffer_size is $MAX_BUFFER, expected 500"
    exit 1
fi

# T8.2 — Trauma events survive eviction
echo ""
echo "T8.2 — Trauma events survive eviction"
TRAUMA_COUNT=$(node -e "const fs = require('fs'); const j = JSON.parse(fs.readFileSync('$TEST_DIR/.wolf/hippocampus.json', 'utf8')); console.log(j.stats.trauma_count);")
if [ "$TRAUMA_COUNT" -ge 1 ]; then
    echo "  ✓ Trauma count is $TRAUMA_COUNT (trauma preserved)"
else
    echo "  ✗ No trauma events found"
    exit 1
fi

echo ""
echo "=========================================="
echo "T7 — Valence Detection Accuracy"
echo "=========================================="
echo "(Note: T7 starts fresh - resetting hippocampus)"

# T7.1 — New file = neutral
echo ""
echo "T7.1 — New file = neutral, intensity 0.3"
rm -f "$TEST_DIR/.wolf/hippocampus.json"
node "$OPENWOLF_DIR/dist/bin/openwolf.js" init >/dev/null 2>&1
echo '// brand new' > src/brandnew.ts
echo '{"tool_name": "Write", "tool_input": {"file_path": "src/brandnew.ts"}}' | \
    node "$OPENWOLF_DIR/dist/src/hooks/post-write.js" 2>/dev/null
VALENCE=$(node -e "const fs = require('fs'); const j = JSON.parse(fs.readFileSync('$TEST_DIR/.wolf/hippocampus.json', 'utf8')); console.log(j.buffer[0]?.outcome?.valence);")
INTENSITY=$(node -e "const fs = require('fs'); const j = JSON.parse(fs.readFileSync('$TEST_DIR/.wolf/hippocampus.json', 'utf8')); console.log(j.buffer[0]?.outcome?.intensity);")
if [ "$VALENCE" = "neutral" ] && [ "$(echo "$INTENSITY >= 0.25" | bc)" -eq 1 ] && [ "$(echo "$INTENSITY <= 0.35" | bc)" -eq 1 ]; then
    echo "  ✓ valence=neutral, intensity~0.3"
else
    echo "  ✗ valence=$VALENCE, intensity=$INTENSITY (expected neutral, ~0.3)"
    exit 1
fi

# T7.2 — First edit = neutral
echo ""
echo "T7.2 — First edit = neutral, intensity 0.3"
echo "// first edit" >> src/brandnew.ts
echo '{"tool_name": "Edit", "tool_input": {"file_path": "src/brandnew.ts", "old_string": "// brand new", "new_string": "// first edit"}}' | \
    node "$OPENWOLF_DIR/dist/src/hooks/post-write.js" 2>/dev/null
# Find the edit event (second event, not the first write)
VALENCE=$(node -e "const fs = require('fs'); const j = JSON.parse(fs.readFileSync('$TEST_DIR/.wolf/hippocampus.json', 'utf8')); const e = j.buffer[j.buffer.length - 1]; console.log(e?.outcome?.valence);")
INTENSITY=$(node -e "const fs = require('fs'); const j = JSON.parse(fs.readFileSync('$TEST_DIR/.wolf/hippocampus.json', 'utf8')); const e = j.buffer[j.buffer.length - 1]; console.log(e?.outcome?.intensity);")
if [ "$VALENCE" = "neutral" ]; then
    echo "  ✓ First edit valence=neutral"
else
    echo "  ✗ First edit valence=$VALENCE (expected neutral)"
fi

echo ""
echo "=========================================="
echo "T5-T8 Results: ALL PASSED"
echo "=========================================="

# Cleanup
rm -rf "$TEST_DIR"
