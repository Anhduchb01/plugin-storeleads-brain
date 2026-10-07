import type { ClickHouseClient } from '@clickhouse/client';
import { checkSql } from './sqlGuard.js';

export interface QueryResult {
  ok: boolean;
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
  error: string;
  ms: number;
}

export type RunQuery = (sql: string) => Promise<QueryResult>;

/** Runs a guarded, read-only query on the slim database with a row cap and a time limit. */
export function clickhouseRunner(read: ClickHouseClient, opts: { maxRows: number; timeoutSeconds: number }): RunQuery {
  return async (raw) => {
    const started = performance.now();
    const fail = (error: string): QueryResult => ({
      ok: false,
      columns: [],
      rows: [],
      rowCount: 0,
      truncated: false,
      error,
      ms: performance.now() - started,
    });

    const guard = checkSql(raw);
    if (!guard.ok) return fail(guard.reason);
    try {
      const rs = await read.query({
        query: guard.sql,
        format: 'JSONCompact',
        clickhouse_settings: {
          max_execution_time: opts.timeoutSeconds,
          // One row over the cap tells us the result was cut.
          max_result_rows: String(opts.maxRows + 1),
          result_overflow_mode: 'break',
        },
      });
      const body = await rs.json<unknown[]>();
      const data = body.data as unknown[][];
      const truncated = data.length > opts.maxRows;
      return {
        ok: true,
        columns: body.meta?.map((m) => m.name) ?? [],
        rows: truncated ? data.slice(0, opts.maxRows) : data,
        rowCount: Math.min(data.length, opts.maxRows),
        truncated,
        error: '',
        ms: performance.now() - started,
      };
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  };
}

/** Compact text for Claude: a TSV table, plus a note when rows were cut. */
export function formatResult(r: QueryResult, maxRows: number): string {
  if (!r.ok) return `Query failed: ${r.error}`;
  const cell = (v: unknown) => (v === null ? 'NULL' : typeof v === 'object' ? JSON.stringify(v) : String(v)).replace(/[\t\n]/g, ' ');
  const lines = [r.columns.join('\t'), ...r.rows.map((row) => row.map(cell).join('\t'))];
  const note = r.truncated
    ? `\n(Showing the first ${maxRows} rows; the result has more. Aggregate in SQL, or for a full store list say: "DM Toàn (Thomas) on Slack with these filters".)`
    : '';
  return `${r.rowCount} row(s), ${Math.round(r.ms)} ms\n${lines.join('\n')}${note}`;
}
