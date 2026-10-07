#!/usr/bin/env bash
# Removes every token of a user:  deploy/revoke-token.sh U012ABC   (takes effect within seconds)
set -euo pipefail
cd "$(dirname "$0")"
[ $# -eq 1 ] || { echo "usage: $0 <user_id>" >&2; exit 1; }
before=$(grep -c . tokens/tokens.txt || true)
awk -v u="$1" '$1 ~ /^#/ || $2 != u' tokens/tokens.txt > tokens/tokens.txt.new
mv tokens/tokens.txt.new tokens/tokens.txt && chmod 600 tokens/tokens.txt
echo "removed $((before - $(grep -c . tokens/tokens.txt || true))) token(s) for $1"
