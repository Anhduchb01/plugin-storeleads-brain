#!/usr/bin/env bash
# Run once in deploy/: writes .env with fresh secrets (kept if it already exists) and an empty tokens.txt.
set -euo pipefail
cd "$(dirname "$0")"
umask 077
if [ ! -f .env ]; then
  cat > .env <<ENV
PUBLIC_URL=https://storeleads-brain.ecvision.ai
TRUST_PROXY=1
# token now; slack once the Slack app has PUBLIC_URL/oauth/slack/callback as a redirect URL
AUTH_MODE=token
JWT_SECRET=$(openssl rand -hex 32)
SLACK_CLIENT_ID=
SLACK_CLIENT_SECRET=
SLACK_TEAM_ID=
CLICKHOUSE_READ_USER=brain_read
CLICKHOUSE_READ_PASSWORD=$(openssl rand -hex 24)
CLICKHOUSE_WRITE_USER=brain_write
CLICKHOUSE_WRITE_PASSWORD=$(openssl rand -hex 24)
CLICKHOUSE_USAGE_DB=usage
QUERY_MAX_ROWS=500
QUERY_TIMEOUT_SECONDS=60
TURN_IDLE_MINUTES=15
# 1 = also keep prompts that never touched StoreLeads (hooks see every prompt in every project)
LOG_ALL_TURNS=0
# Distiller off for now: turns are logged, not labelled. Set ANTHROPIC_API_KEY and remove this to turn it on.
DISTILL_DISABLED=1
ANTHROPIC_API_KEY=
ENV
  echo "wrote deploy/.env"
else
  echo "deploy/.env exists, kept"
fi
grep -q '^BRAIN_UID=' .env || printf 'BRAIN_UID=%s\nBRAIN_GID=%s\n' "$(id -u)" "$(id -g)" >> .env
[ -f tokens.txt ] || { printf '# token user_id display name   (deploy/new-token.sh adds lines)\n' > tokens.txt; echo "wrote deploy/tokens.txt"; }
chmod 600 .env tokens.txt
