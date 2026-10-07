// A cheap first gate in front of ClickHouse. The real boundary is the read user's grants
// (SELECT on slim.* only, profile readonly=2); this rejects the obvious cases early with a
// message Claude can act on, and enforces the skill's "never touch these tables" rule.

export type GuardResult = { ok: true; sql: string } | { ok: false; reason: string };

/** Blank out string literals and comments so keyword checks don't trip on their contents. */
export function stripLiteralsAndComments(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1];
    if (c === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      out += ' ';
    } else if (c === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
      out += ' ';
    } else if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      i++;
      while (i < sql.length) {
        if (sql[i] === '\\') i += 2;
        else if (sql[i] === quote && sql[i + 1] === quote) i += 2;
        else if (sql[i] === quote) break;
        else i++;
      }
      i++;
      // Keep quoted identifiers recognisable as a word, literals as an empty string.
      out += quote === "'" ? "''" : ' x ';
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const WRITE_OR_ADMIN =
  /\b(insert|update|delete|alter|drop|create|truncate|rename|grant|revoke|kill|optimize|attach|detach|exchange|undrop|set|use|backup|restore|outfile)\b/i;

// Table functions that reach outside ClickHouse or across clusters.
const TABLE_FUNCTIONS =
  /\b(url|file|s3|s3cluster|gcs|azureblobstorage|hdfs|remote|remotesecure|cluster|clusterallreplicas|mysql|postgresql|jdbc|odbc|mongodb|redis|sqlite|input|executable|dictionary)\s*\(/i;

// Databases other than slim. Aliased columns (d.app_key) look the same as db.table, so this is a deny list.
const OTHER_DATABASES = /\b(system|information_schema|default|usage)\s*\./i;

// SKILL.md rule 8: never use these tables.
const FORBIDDEN_TABLES = /\b(?:slim\s*\.\s*)?(stg_\w+|mv_\w+|land|loaded_months)\b/i;

export function checkSql(raw: string): GuardResult {
  const sql = raw.trim().replace(/;\s*$/, '');
  if (!sql) return { ok: false, reason: 'Empty query.' };
  const bare = stripLiteralsAndComments(sql);

  if (bare.includes(';')) return { ok: false, reason: 'Send one statement per call (no `;` between statements).' };
  const first = bare.trim().replace(/^\(+\s*/, '').split(/\s+/)[0]?.toLowerCase();
  if (first !== 'select' && first !== 'with') {
    return { ok: false, reason: 'Only SELECT / WITH queries are allowed (read-only).' };
  }
  const write = bare.match(WRITE_OR_ADMIN);
  if (write) return { ok: false, reason: `Keyword "${write[1]}" is not allowed: queries are read-only.` };
  const fn = bare.match(TABLE_FUNCTIONS);
  if (fn) return { ok: false, reason: `Table function ${fn[1]}() is not allowed.` };
  const db = bare.match(OTHER_DATABASES);
  if (db) return { ok: false, reason: `Database "${db[1]}" is off limits — query only the slim database.` };
  const table = bare.match(FORBIDDEN_TABLES);
  if (table) {
    return { ok: false, reason: `Table "${table[1]}" is internal staging — use the slim tables listed in the skill.` };
  }
  return { ok: true, sql };
}
