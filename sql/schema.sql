-- storeleads-brain: usage database. Run once as an admin:
--   clickhouse-client --multiquery < sql/schema.sql
-- Then the two users (see the bottom of this file).

CREATE DATABASE IF NOT EXISTS usage;

-- One row per question → answer turn that touched StoreLeads (ran a query or called record).
-- Never read back into a conversation: this is for analysis only.
CREATE TABLE IF NOT EXISTS usage.qa_log
(
    turn_id          UUID,
    started_at       DateTime64(3),
    ended_at         DateTime64(3),
    user_id          LowCardinality(String),      -- Slack user id (or dev handle)
    user_name        String,
    client           LowCardinality(String),      -- MCP clientInfo name, e.g. claude-code, claude-ai
    conversation     String,                      -- MCP session id
    client_session   String,                      -- Claude Code session_id when hooks are on
    previous_turn_id String,                      -- earlier turn in the same conversation, '' if first
    question         String,
    question_source  LowCardinality(String),      -- hook | tool | none
    answer           String TTL toDateTime(started_at) + INTERVAL 180 DAY,
    answer_source    LowCardinality(String),      -- hook | tool | none
    model_outcome    LowCardinality(String),      -- outcome hint passed to record, '' if none
    model_data_gap   String,
    q_sql            Array(String),
    q_ok             Array(UInt8),
    q_error          Array(String),
    q_rows           Array(UInt32),
    q_ms             Array(UInt32),
    recalled_ids     Array(String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(started_at)
ORDER BY (started_at, user_id);

-- What the distiller made of each turn. Join on turn_id.
CREATE TABLE IF NOT EXISTS usage.qa_distill
(
    turn_id              UUID,
    distilled_at         DateTime64(3),
    use_case             LowCardinality(String),  -- id from references/use-cases.md, or new:<label>
    outcome              LowCardinality(String),  -- answered | partial | asked_back | failed | refused
    data_gap             String,                  -- what data would have been needed, '' if none
    apps                 Array(String),
    categories           Array(String),
    countries            Array(String),
    months               Array(Int8),
    feedback_on_previous LowCardinality(String),  -- none | confirmed | corrected | unclear
    model                LowCardinality(String),
    memory_ids           Array(String)
)
ENGINE = ReplacingMergeTree(distilled_at)
ORDER BY turn_id;

-- Distilled, reusable knowledge. One logical row per id; read with FINAL.
CREATE TABLE IF NOT EXISTS usage.memory
(
    id             String,                        -- hash of (scope, kind, dedupe_key)
    version        UInt64,                        -- ms timestamp, newest wins
    kind           LowCardinality(String),        -- alias | query | fix | correction | insight | preference
    scope          String,                        -- team | user:<id>
    dedupe_key     String,
    keys           Array(String),                 -- normalised lookup keys (src/keys.ts)
    text           String,
    sql            String,
    snapshot_month Int8,                          -- 0-23 for insights, -1 otherwise
    status         LowCardinality(String),        -- candidate | verified | rejected
    evidence       UInt32,                        -- distinct turns that produced or confirmed it
    source_turns   Array(String),
    created_by     String,
    updated_at     DateTime64(3)
)
ENGINE = ReplacingMergeTree(version)
ORDER BY id;

-- Analysis view: every logged turn with its distillation.
CREATE VIEW IF NOT EXISTS usage.qa AS
SELECT l.*, d.use_case, d.outcome, d.data_gap, d.apps, d.categories, d.countries, d.months, d.feedback_on_previous
FROM usage.qa_log AS l
LEFT JOIN (SELECT * FROM usage.qa_distill FINAL) AS d USING turn_id;

-- Users (adjust passwords; the server needs both):
--   CREATE USER brain_read IDENTIFIED BY '...' SETTINGS PROFILE 'readonly';   -- a profile with readonly = 2
--   GRANT SELECT ON slim.* TO brain_read;                                      -- nothing else, in particular not usage.*
--   CREATE USER brain_write IDENTIFIED BY '...';
--   GRANT SELECT, INSERT ON usage.* TO brain_write;
