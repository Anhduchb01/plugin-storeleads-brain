import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkSql } from '../src/sqlGuard.js';

const SKILL = new URL('../skill-src/storeleads-grafana/SKILL.md', import.meta.url);

describe('checkSql', () => {
  it('accepts every SQL recipe in the StoreLeads skill', () => {
    const recipes = [...readFileSync(SKILL, 'utf8').matchAll(/```sql\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(recipes.length).toBeGreaterThanOrEqual(9);
    for (const sql of recipes) expect(checkSql(sql), sql).toMatchObject({ ok: true });
  });

  it('accepts a trailing semicolon and keywords inside strings and comments', () => {
    expect(checkSql("SELECT 'drop table x; insert' AS s -- delete\n;").ok).toBe(true);
    expect(checkSql("SELECT name FROM slim.app_dim WHERE name ILIKE '%system.%'").ok).toBe(true);
  });

  it.each([
    ['INSERT INTO slim.app_dim VALUES (1)', 'read-only'],
    ['SELECT 1; DROP TABLE slim.app_dim', 'one statement'],
    ['ALTER TABLE slim.app_dim DELETE WHERE 1', 'read-only'],
    ['WITH x AS (SELECT 1) SELECT * FROM x SETTINGS readonly = 0; SET allow_ddl = 1', 'one statement'],
    ['SELECT * FROM system.users', 'off limits'],
    ['SELECT * FROM usage.qa_log', 'off limits'],
    ['SELECT * FROM slim.stg_apps', 'staging'],
    ['SELECT * FROM land', 'staging'],
    ["SELECT * FROM url('http://evil/x', CSV)", 'Table function'],
    ["SELECT * FROM remote('other:9000', slim.app_dim)", 'Table function'],
    ['SHOW TABLES', 'Only SELECT'],
    ['SELECT 1 INTO OUTFILE \'x\'', 'read-only'],
  ])('rejects %s', (sql, why) => {
    const r = checkSql(sql);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain(why);
  });
});
