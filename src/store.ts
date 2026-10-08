import { createHash } from 'node:crypto';
import type { ClickHouseClient } from '@clickhouse/client';

export interface QueryLog {
  sql: string;
  ok: boolean;
  error: string;
  rows: number;
  ms: number;
}

export type Source = 'hook' | 'tool' | 'none';

export interface TurnRecord {
  turnId: string;
  startedAt: Date;
  endedAt: Date;
  userId: string;
  userName: string;
  client: string;
  conversation: string;
  clientSession: string;
  previousTurnId: string;
  question: string;
  questionSource: Source;
  answer: string;
  answerSource: Source;
  modelOutcome: string;
  modelDataGap: string;
  /** What Claude said is worth remembering for next time (record's `learned`). */
  modelLearned: string;
  queries: QueryLog[];
  recalledIds: string[];
}

export const MEMORY_KINDS = ['alias', 'query', 'fix', 'correction', 'insight', 'preference'] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];
export type MemoryStatus = 'candidate' | 'verified' | 'rejected';

export interface Memory {
  id: string;
  kind: MemoryKind;
  scope: string; // 'team' or 'user:<id>'
  dedupeKey: string;
  keys: string[];
  text: string;
  sql: string;
  snapshotMonth: number; // -1 when not tied to a snapshot
  status: MemoryStatus;
  evidence: number;
  sourceTurns: string[];
  createdBy: string;
  updatedAt: Date;
}

export interface Distill {
  turnId: string;
  distilledAt: Date;
  useCase: string;
  outcome: string;
  dataGap: string;
  apps: string[];
  categories: string[];
  countries: string[];
  months: number[];
  feedbackOnPrevious: string;
  model: string;
  memoryIds: string[];
}

export interface UsageStore {
  insertTurn(turn: TurnRecord): Promise<void>;
  insertDistill(distill: Distill): Promise<void>;
  getDistill(turnId: string): Promise<Distill | undefined>;
  getMemories(ids: string[]): Promise<Memory[]>;
  putMemory(memory: Memory): Promise<void>;
  /** Non-rejected memories visible to this user whose keys overlap, best first. */
  searchMemories(keys: string[], userScope: string, limit: number): Promise<Memory[]>;
  /** The user's own preference memories, newest first. */
  preferences(userScope: string, limit: number): Promise<Memory[]>;
}

export function memoryId(scope: string, kind: string, dedupeKey: string): string {
  return createHash('sha256').update(`${scope}\u0000${kind}\u0000${dedupeKey}`).digest('hex').slice(0, 32);
}

/** Order used by both stores: key overlap, then verified before candidate, then evidence, then recency. */
export function rankMemories(memories: Memory[], keys: string[]): Memory[] {
  const wanted = new Set(keys);
  const overlap = (m: Memory) => m.keys.filter((k) => wanted.has(k)).length;
  return [...memories].sort(
    (a, b) =>
      overlap(b) - overlap(a) ||
      Number(b.status === 'verified') - Number(a.status === 'verified') ||
      b.evidence - a.evidence ||
      b.updatedAt.getTime() - a.updatedAt.getTime(),
  );
}

// ---------------------------------------------------------------------------------------------
// ClickHouse

const ts = (d: Date) => d.toISOString().replace('T', ' ').replace('Z', '');

interface MemoryRow {
  id: string;
  kind: MemoryKind;
  scope: string;
  dedupe_key: string;
  keys: string[];
  text: string;
  sql: string;
  snapshot_month: number;
  status: MemoryStatus;
  evidence: number;
  source_turns: string[];
  created_by: string;
  updated_ms: string;
}

const MEMORY_COLUMNS = `id, kind, scope, dedupe_key, keys, text, sql, snapshot_month, status, evidence, source_turns,
  created_by, toUnixTimestamp64Milli(updated_at) AS updated_ms`;

function fromRow(r: MemoryRow): Memory {
  return {
    id: r.id,
    kind: r.kind,
    scope: r.scope,
    dedupeKey: r.dedupe_key,
    keys: r.keys,
    text: r.text,
    sql: r.sql,
    snapshotMonth: Number(r.snapshot_month),
    status: r.status,
    evidence: Number(r.evidence),
    sourceTurns: r.source_turns,
    createdBy: r.created_by,
    updatedAt: new Date(Number(r.updated_ms)),
  };
}

export class ClickHouseUsageStore implements UsageStore {
  constructor(
    private readonly ch: ClickHouseClient,
    private readonly db: string,
  ) {}

  private async insert(table: string, values: Record<string, unknown>[]) {
    await this.ch.insert({
      table: `${this.db}.${table}`,
      values,
      format: 'JSONEachRow',
      clickhouse_settings: { date_time_input_format: 'best_effort' },
    });
  }

  private async select<T>(query: string, params: Record<string, unknown>): Promise<T[]> {
    const rs = await this.ch.query({ query, query_params: params, format: 'JSONEachRow' });
    return rs.json<T>();
  }

  async insertTurn(t: TurnRecord) {
    await this.insert('qa_log', [
      {
        turn_id: t.turnId,
        started_at: ts(t.startedAt),
        ended_at: ts(t.endedAt),
        user_id: t.userId,
        user_name: t.userName,
        client: t.client,
        conversation: t.conversation,
        client_session: t.clientSession,
        previous_turn_id: t.previousTurnId,
        question: t.question,
        question_source: t.questionSource,
        answer: t.answer,
        answer_source: t.answerSource,
        model_outcome: t.modelOutcome,
        model_data_gap: t.modelDataGap,
        model_learned: t.modelLearned,
        q_sql: t.queries.map((q) => q.sql),
        q_ok: t.queries.map((q) => (q.ok ? 1 : 0)),
        q_error: t.queries.map((q) => q.error),
        q_rows: t.queries.map((q) => q.rows),
        q_ms: t.queries.map((q) => Math.round(q.ms)),
        recalled_ids: t.recalledIds,
      },
    ]);
  }

  async insertDistill(d: Distill) {
    await this.insert('qa_distill', [
      {
        turn_id: d.turnId,
        distilled_at: ts(d.distilledAt),
        use_case: d.useCase,
        outcome: d.outcome,
        data_gap: d.dataGap,
        apps: d.apps,
        categories: d.categories,
        countries: d.countries,
        months: d.months,
        feedback_on_previous: d.feedbackOnPrevious,
        model: d.model,
        memory_ids: d.memoryIds,
      },
    ]);
  }

  async getDistill(turnId: string): Promise<Distill | undefined> {
    const rows = await this.select<{
      use_case: string;
      outcome: string;
      data_gap: string;
      apps: string[];
      categories: string[];
      countries: string[];
      months: number[];
      feedback_on_previous: string;
      model: string;
      memory_ids: string[];
      distilled_ms: string;
    }>(
      `SELECT use_case, outcome, data_gap, apps, categories, countries, months, feedback_on_previous, model, memory_ids,
              toUnixTimestamp64Milli(distilled_at) AS distilled_ms
       FROM ${this.db}.qa_distill FINAL WHERE turn_id = {turnId:UUID}`,
      { turnId },
    );
    const r = rows[0];
    if (!r) return undefined;
    return {
      turnId,
      distilledAt: new Date(Number(r.distilled_ms)),
      useCase: r.use_case,
      outcome: r.outcome,
      dataGap: r.data_gap,
      apps: r.apps,
      categories: r.categories,
      countries: r.countries,
      months: r.months.map(Number),
      feedbackOnPrevious: r.feedback_on_previous,
      model: r.model,
      memoryIds: r.memory_ids,
    };
  }

  async getMemories(ids: string[]): Promise<Memory[]> {
    if (!ids.length) return [];
    const rows = await this.select<MemoryRow>(
      `SELECT ${MEMORY_COLUMNS} FROM ${this.db}.memory FINAL WHERE id IN {ids:Array(String)}`,
      { ids },
    );
    return rows.map(fromRow);
  }

  async putMemory(m: Memory) {
    await this.insert('memory', [
      {
        id: m.id,
        version: m.updatedAt.getTime(),
        kind: m.kind,
        scope: m.scope,
        dedupe_key: m.dedupeKey,
        keys: m.keys,
        text: m.text,
        sql: m.sql,
        snapshot_month: m.snapshotMonth,
        status: m.status,
        evidence: m.evidence,
        source_turns: m.sourceTurns,
        created_by: m.createdBy,
        updated_at: ts(m.updatedAt),
      },
    ]);
  }

  async searchMemories(keys: string[], userScope: string, limit: number): Promise<Memory[]> {
    if (!keys.length) return [];
    const rows = await this.select<MemoryRow>(
      `SELECT ${MEMORY_COLUMNS}
       FROM ${this.db}.memory FINAL
       WHERE status != 'rejected' AND kind != 'preference'
         AND scope IN ('team', {userScope:String})
         AND hasAny(keys, {keys:Array(String)})
       ORDER BY length(arrayIntersect(keys, {keys:Array(String)})) DESC, status = 'verified' DESC, evidence DESC, updated_at DESC
       LIMIT {limit:UInt32}`,
      { keys, userScope, limit },
    );
    return rows.map(fromRow);
  }

  async preferences(userScope: string, limit: number): Promise<Memory[]> {
    const rows = await this.select<MemoryRow>(
      `SELECT ${MEMORY_COLUMNS}
       FROM ${this.db}.memory FINAL
       WHERE kind = 'preference' AND status != 'rejected' AND scope = {userScope:String}
       ORDER BY updated_at DESC LIMIT {limit:UInt32}`,
      { userScope, limit },
    );
    return rows.map(fromRow);
  }
}

// ---------------------------------------------------------------------------------------------
// In-memory (tests, local runs without ClickHouse)

export class InMemoryUsageStore implements UsageStore {
  turns: TurnRecord[] = [];
  distills = new Map<string, Distill>();
  memories = new Map<string, Memory>();

  async insertTurn(t: TurnRecord) {
    this.turns.push(structuredClone(t));
  }
  async insertDistill(d: Distill) {
    this.distills.set(d.turnId, structuredClone(d));
  }
  async getDistill(turnId: string) {
    return this.distills.get(turnId);
  }
  async getMemories(ids: string[]) {
    return ids.map((id) => this.memories.get(id)).filter((m): m is Memory => Boolean(m));
  }
  async putMemory(m: Memory) {
    this.memories.set(m.id, structuredClone(m));
  }
  async searchMemories(keys: string[], userScope: string, limit: number) {
    const wanted = new Set(keys);
    const hits = [...this.memories.values()].filter(
      (m) =>
        m.status !== 'rejected' &&
        m.kind !== 'preference' &&
        (m.scope === 'team' || m.scope === userScope) &&
        m.keys.some((k) => wanted.has(k)),
    );
    return rankMemories(hits, keys).slice(0, limit);
  }
  async preferences(userScope: string, limit: number) {
    return [...this.memories.values()]
      .filter((m) => m.kind === 'preference' && m.status !== 'rejected' && m.scope === userScope)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, limit);
  }
}
