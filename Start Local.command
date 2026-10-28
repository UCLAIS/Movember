#!/bin/sh
set -eu
cd "$(dirname "$0")"

if [ -x .local/bin/node ]; then
  node_path="$PWD/.local/bin/node"
elif command -v node >/dev/null 2>&1; then
  node_path="$(command -v node)"
else
  printf 'Install Node.js 24 or later, then run this launcher again.\n'
  exit 1
fi

exec "$node_path" --use-env-proxy scripts/dev.mjs "$@"
