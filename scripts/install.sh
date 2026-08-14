#!/bin/bash
# OpenWolf Local Install Script
# Installs the local openwolf build globally
#
# Usage:
#   ./scripts/install.sh        # Install globally
#   ./scripts/install.sh --dev  # Link as dev dependency

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR/.."

echo "=== OpenWolf Local Install ==="
echo ""

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    echo "Error: OpenWolf requires Node.js 20+. Current version: $(node -v)"
    exit 1
fi

# Build the project
echo "Building OpenWolf..."
cd "$PROJECT_ROOT"
pnpm install
pnpm build

if [ ! -f "$PROJECT_ROOT/dist/bin/openwolf.js" ]; then
    echo "Error: Build failed - openwolf.js not found"
    exit 1
fi

# Ensure dist/bin/openwolf.js is executable
chmod +x "$PROJECT_ROOT/dist/bin/openwolf.js"

if [ "$1" = "--dev" ]; then
    echo ""
    echo "Linking as dev dependency..."
    cd "$PROJECT_ROOT"
    npm link
    echo ""
    echo "Done! Run 'npm link openwolf' in any project to use this local version."
else
    echo ""
    echo "Installing globally..."
    npm install -g "$PROJECT_ROOT"

    # Verify install
    if command -v openwolf &> /dev/null; then
        echo ""
        echo "Success! openwolf $(openwolf --version 2>/dev/null || echo "installed")"
        echo ""
        echo "Usage:"
        echo "  cd your-project"
        echo "  openwolf init"
    else
        echo ""
        echo "Installed but 'openwolf' command not found in PATH."
        echo "Try: export PATH=\"\$(npm root -g):\$PATH\""
    fi
fi

echo ""
echo "Project root: $PROJECT_ROOT"
