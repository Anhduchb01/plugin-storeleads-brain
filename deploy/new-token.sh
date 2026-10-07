#!/usr/bin/env bash
# Hands out a personal token:  deploy/new-token.sh U012ABC "Nguyễn Văn A"
# Prints the token once; the server picks it up within seconds (no restart). Revoke by deleting the line.
set -euo pipefail
cd "$(dirname "$0")"
[ $# -ge 1 ] || { echo "usage: $0 <user_id> [display name]" >&2; exit 1; }
token=$(openssl rand -hex 24)
printf '%s %s %s\n' "$token" "$1" "${*:2}" >> tokens.txt
echo "$token"
