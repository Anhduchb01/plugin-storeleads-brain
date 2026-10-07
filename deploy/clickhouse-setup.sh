#!/usr/bin/env bash
# Creates the usage database, brain_read (SELECT on slim only, readonly=2) and brain_write (SELECT, INSERT on usage)
# in the storeleads-clickhouse container, with the passwords from deploy/.env. Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a
CH=${CLICKHOUSE_CONTAINER:-storeleads-clickhouse}

{
  cat ../sql/schema.sql
  cat <<SQL
CREATE SETTINGS PROFILE IF NOT EXISTS brain_readonly SETTINGS readonly = 2, max_memory_usage = 4000000000;
CREATE USER IF NOT EXISTS ${CLICKHOUSE_READ_USER} IDENTIFIED WITH sha256_password BY '${CLICKHOUSE_READ_PASSWORD}' SETTINGS PROFILE 'brain_readonly';
ALTER USER ${CLICKHOUSE_READ_USER} IDENTIFIED WITH sha256_password BY '${CLICKHOUSE_READ_PASSWORD}' SETTINGS PROFILE 'brain_readonly';
GRANT SELECT ON slim.* TO ${CLICKHOUSE_READ_USER};
CREATE USER IF NOT EXISTS ${CLICKHOUSE_WRITE_USER} IDENTIFIED WITH sha256_password BY '${CLICKHOUSE_WRITE_PASSWORD}';
ALTER USER ${CLICKHOUSE_WRITE_USER} IDENTIFIED WITH sha256_password BY '${CLICKHOUSE_WRITE_PASSWORD}';
GRANT SELECT, INSERT ON ${CLICKHOUSE_USAGE_DB}.* TO ${CLICKHOUSE_WRITE_USER};
SQL
} | docker exec -i "$CH" bash -c 'clickhouse-client --user "$CLICKHOUSE_USER" --password "$CLICKHOUSE_PASSWORD" --multiquery'

echo "ClickHouse ready: database ${CLICKHOUSE_USAGE_DB}, users ${CLICKHOUSE_READ_USER} / ${CLICKHOUSE_WRITE_USER}"
