#!/usr/bin/env bash
set -euo pipefail

# Push `scanner/` as a standalone Docker Space to Hugging Face Spaces:
#   https://huggingface.co/spaces/juanevillam/book-highlighter-scanner
#
# Usage:
#   ./scripts/deploy-hf-space.sh [hf_username/space_name]

SPACE_REPO="${1:-juanevillam/book-highlighter-scanner}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "→ Preparing Hugging Face Space bundle for $SPACE_REPO..."
cp -R "$ROOT_DIR/scanner/." "$TMP_DIR/"
rm -rf "$TMP_DIR/.venv" "$TMP_DIR/__pycache__" "$TMP_DIR/.pytest_cache"

cd "$TMP_DIR"
git init -q -b main
git config commit.gpgsign false
git add Dockerfile README.md requirements.txt pyproject.toml *.py tests/
git commit -q -m "Deploy Book Highlighter RAM-only scanner to Hugging Face Spaces"

echo "→ Pushing to https://huggingface.co/spaces/$SPACE_REPO ..."
git push --force "https://huggingface.co/spaces/$SPACE_REPO" main
echo "✓ Deployed! Live endpoint: https://$(echo "$SPACE_REPO" | tr '/' '-').hf.space"
