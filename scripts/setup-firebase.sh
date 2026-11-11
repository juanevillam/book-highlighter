#!/usr/bin/env bash
set -euo pipefail

# Provision or link the fresh `book-highlighter` Firebase project, register its Web App,
# write `.env.local`, and deploy `firestore.rules` + `firestore.indexes.json`.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PROJECT_ID="${FIREBASE_PROJECT_ID:-book-highlighter-juanevillam}"

echo "→ Checking Firebase CLI authentication..."
if ! npx firebase-tools login:list 2>/dev/null | grep -q '@'; then
  echo "→ Signing in to Firebase..."
  npx firebase-tools login
fi

echo "→ Ensuring Firebase project '$PROJECT_ID' exists..."
if ! npx firebase-tools projects:list --json | grep -q "\"projectId\": \"$PROJECT_ID\""; then
  npx firebase-tools projects:create "$PROJECT_ID" --display-name "Book Highlighter"
fi

echo "→ Ensuring Web App is registered on '$PROJECT_ID'..."
APPS_JSON="$(npx firebase-tools apps:list WEB --project "$PROJECT_ID" --json)"
APP_ID="$(node -e "const d = JSON.parse(process.argv[1]); const list = d.result || []; process.stdout.write(list[0]?.appId || '');" "$APPS_JSON")"

if [[ -z "$APP_ID" ]]; then
  CREATE_JSON="$(npx firebase-tools apps:create WEB "Book Highlighter Web" --project "$PROJECT_ID" --json)"
  APP_ID="$(node -e "const d = JSON.parse(process.argv[1]); process.stdout.write(d.result?.appId || '');" "$CREATE_JSON")"
fi

echo "→ Reading Web SDK config for app '$APP_ID'..."
SDK_JSON="$(npx firebase-tools apps:sdkconfig WEB "$APP_ID" --project "$PROJECT_ID" --json)"

node -e '
const fs = require("fs");
const raw = JSON.parse(process.argv[1]);
const cfg = raw.result?.sdkConfig || raw.result || {};
const lines = [
  `VITE_FIREBASE_PROJECT_ID=${cfg.projectId || "book-highlighter"}`,
  `VITE_FIREBASE_API_KEY=${cfg.apiKey || ""}`,
  `VITE_FIREBASE_AUTH_DOMAIN=${cfg.authDomain || "book-highlighter.firebaseapp.com"}`,
  `VITE_FIREBASE_STORAGE_BUCKET=${cfg.storageBucket || "book-highlighter.firebasestorage.app"}`,
  `VITE_FIREBASE_MESSAGING_SENDER_ID=${cfg.messagingSenderId || ""}`,
  `VITE_FIREBASE_APP_ID=${cfg.appId || ""}`,
  `VITE_MEDIA_WORKER_URL=https://book-highlighter-media-worker.juanesvillamendoza.workers.dev`,
  ""
];
fs.writeFileSync(".env.local", lines.join("\n"), "utf8");
console.log("✓ Wrote .env.local");
' "$SDK_JSON"

echo "→ Deploying Firestore security rules & indexes..."
npx firebase-tools deploy --only firestore:rules,firestore:indexes --project "$PROJECT_ID"

echo "✓ Firebase setup complete. Enable Google Sign-In in Firebase Console → Authentication → Sign-in method."
