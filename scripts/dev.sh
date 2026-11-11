#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SCANNER_PID=""
TUNNEL_PID=""
TUNNEL_LOG="$(mktemp -t bh-tunnel.XXXXXX)"

sync_dev_origin() {
  local mode="$1"
  local host="${2:-}"
  npx --yes firebase-tools projects:list >/dev/null 2>&1 || true
  python3 - "$mode" "$host" <<'PY' 2>/dev/null || true
import json, os, sys, urllib.request

mode = sys.argv[1]
host = sys.argv[2] if len(sys.argv) > 2 else ""
cfg_path = os.path.expanduser("~/.config/configstore/firebase-tools.json")
if not os.path.exists(cfg_path):
    sys.exit(0)
token = json.load(open(cfg_path))["tokens"]["access_token"]
headers = {
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json",
    "x-goog-user-project": "book-highlighter-juanevillam",
}

auth_url = "https://identitytoolkit.googleapis.com/admin/v2/projects/book-highlighter-juanevillam/config"
base_domains = ["localhost", "book-highlighter-juanevillam.firebaseapp.com", "bookhighlighter.juanevillam.com"]
domains = base_domains + ([host] if mode == "add" and host else [])
req = urllib.request.Request(
    auth_url + "?updateMask=authorizedDomains",
    data=json.dumps({"authorizedDomains": domains}).encode(),
    headers=headers,
    method="PATCH",
)
urllib.request.urlopen(req, timeout=8).read()
PY
}

cleanup() {
  if [[ -n "$SCANNER_PID" ]] && kill -0 "$SCANNER_PID" 2>/dev/null; then
    kill "$SCANNER_PID" 2>/dev/null || true
  fi
  if [[ -n "$TUNNEL_PID" ]] && kill -0 "$TUNNEL_PID" 2>/dev/null; then
    kill "$TUNNEL_PID" 2>/dev/null || true
  fi
  sync_dev_origin "remove" ""
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
  cloudflared tunnel --url http://127.0.0.1:5173 --no-autoupdate >"$TUNNEL_LOG" 2>&1 &
  TUNNEL_PID=$!
  (
    for _ in {1..24}; do
      TUNNEL_URL="$(grep -Eo 'https://[-a-z0-9]+\.trycloudflare\.com' "$TUNNEL_LOG" | head -n 1 || true)"
      if [[ -n "$TUNNEL_URL" ]]; then
        TUNNEL_HOST="${TUNNEL_URL#https://}"
        sync_dev_origin "add" "$TUNNEL_HOST"
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "💻 Mac (Local):    http://localhost:5173"
        echo "📱 iPhone (Local): ${TUNNEL_URL}"
        echo "   (Abre ese link en Safari del iPhone: es tu Vite + Python local con HTTPS,"
        echo "    cámara habilitada y Google Sign-In autorizado automáticamente)"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        break
      fi
      sleep 0.5
    done
  ) &
fi

npx vite --port 5173 --strictPort
