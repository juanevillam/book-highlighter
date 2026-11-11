#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SCANNER_PID=""
cleanup() {
  if [[ -n "$SCANNER_PID" ]] && kill -0 "$SCANNER_PID" 2>/dev/null; then
    kill "$SCANNER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

if [[ -x "$ROOT_DIR/scanner/.venv/bin/uvicorn" ]]; then
  echo "→ Starting local Python Book Scanner on http://localhost:8787 ..."
  (
    cd "$ROOT_DIR/scanner"
    .venv/bin/uvicorn server:app --host 0.0.0.0 --port 8787
  ) &
  SCANNER_PID=$!
else
  echo "⚠ scanner/.venv not found; run: cd scanner && uv venv .venv --python 3.12 && uv pip install --python .venv/bin/python -r requirements.txt"
fi

npx vite
