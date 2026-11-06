#!/bin/bash
# Point Claude Desktop's Apple MCP servers at this checkout's local builds.
#
# Claude Desktop rewrites claude_desktop_config.json from memory when it quits,
# so edits made while it runs are lost. Run this from Terminal with Claude
# fully quit (Cmd+Q); it waits for Claude to exit, patches the config, and
# reopens Claude.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
CFG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
NODE="$(command -v node)"

if pgrep -xq Claude; then
  echo "Waiting for Claude to quit (press Cmd+Q in Claude)..."
  while pgrep -xq Claude; do sleep 1; done
fi

cp "$CFG" "$CFG.bak-$(date +%Y%m%d-%H%M%S)"
python3 - "$CFG" "$NODE" "$REPO" <<'EOF'
import json, sys
cfg, node, repo = sys.argv[1:]
d = json.load(open(cfg))
servers = d.setdefault("mcpServers", {})
for name in ["notes", "messages", "reminders", "calendar", "maps"]:
    key = f"apple-{name}"
    if key in servers:
        servers[key] = {"command": node, "args": [f"{repo}/{name}/build/index.js"]}
        print(f"  {key} -> {repo}/{name}/build/index.js")
json.dump(d, open(cfg, "w"), indent=2)
EOF

echo "Config updated. Starting Claude..."
open -a Claude
