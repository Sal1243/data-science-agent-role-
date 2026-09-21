#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -x .venv/bin/python || ! -d node_modules ]]; then
  echo 'Run make install first (Python 3.11+ and Node.js 22+ required).' >&2
  exit 1
fi
.venv/bin/python -m uvicorn backend.app:app --host 0.0.0.0 --port 8000 --reload --reload-dir backend &
api_pid=$!
trap 'kill "$api_pid" 2>/dev/null || true' EXIT INT TERM
npm run dev
