#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SCANNER_PID=""
TUNNEL_PID=""
TUNNEL_LOG="$(mktemp -t bh-tunnel.XXXXXX)"

cleanup() {
  if [[ -n "$SCANNER_PID" ]] && kill -0 "$SCANNER_PID" 2>/dev/null; then
    kill "$SCANNER_PID" 2>/dev/null || true
  fi
  if [[ -n "$TUNNEL_PID" ]] && kill -0 "$TUNNEL_PID" 2>/dev/null; then
    kill "$TUNNEL_PID" 2>/dev/null || true
  fi
  rm -f "$TUNNEL_LOG"
}
trap cleanup EXIT INT TERM

if [[ -x "$ROOT_DIR/scanner/.venv/bin/uvicorn" ]]; then
  echo "→ Starting local Python Book Scanner on http://127.0.0.1:8787 ..."
  (
    cd "$ROOT_DIR/scanner"
    FIREBASE_PROJECT_ID=book-highlighter-juanevillam ALLOW_DEV_UNAUTH=true .venv/bin/uvicorn server:app --host 0.0.0.0 --port 8787
  ) &
  SCANNER_PID=$!
else
  echo "⚠ scanner/.venv not found; run: cd scanner && uv venv .venv --python 3.12 && uv pip install --python .venv/bin/python -r requirements.txt"
fi

if command -v cloudflared >/dev/null 2>&1; then
  cloudflared tunnel --url http://127.0.0.1:8787 --no-autoupdate >"$TUNNEL_LOG" 2>&1 &
  TUNNEL_PID=$!
  (
    for _ in {1..20}; do
      TUNNEL_URL="$(grep -Eo 'https://[-a-z0-9]+\.trycloudflare\.com' "$TUNNEL_LOG" | head -n 1 || true)"
      if [[ -n "$TUNNEL_URL" ]]; then
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "📱 iPhone (Cámara + Google Auth + Escáner Python de tu Mac en vivo):"
        echo "   Abre este link en Safari desde tu iPhone:"
        echo "   https://bookhighlighter.juanevillam.com/?scanner=${TUNNEL_URL}"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        break
      fi
      sleep 0.5
    done
  ) &
fi

npx vite
