import { keysFor } from './keys.js';
import type { Memory, UsageStore } from './store.js';

const MONTH_ZERO = new Date(Date.UTC(2024, 9, 1)); // month 0 = Oct 2024

export function monthLabel(m: number): string {
  const d = new Date(MONTH_ZERO);
  d.setUTCMonth(d.getUTCMonth() + m);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export interface RecallResult {
  memories: Memory[];
  /** Text to put in front of Claude; '' when there is nothing worth saying. */
  text: string;
}

export async function recall(store: UsageStore, question: string, userId: string, limit = 8): Promise<RecallResult> {
  const scope = `user:${userId}`;
  const keys = keysFor(question);
  const [hits, prefs] = await Promise.all([store.searchMemories(keys, scope, limit), store.preferences(scope, 3)]);
  // Preferences only ride along when the question is about StoreLeads at all (something matched).
  const memories = hits.length ? [...hits, ...prefs] : [];
  return { memories, text: formatRecall(memories) };
}

export function formatRecall(memories: Memory[]): string {
  if (!memories.length) return '';
  const lines = memories.map((m) => {
    const tag = `${m.kind}, ${m.status}${m.snapshotMonth >= 0 ? `, snapshot ${monthLabel(m.snapshotMonth)}` : ''}`;
    const sql = m.sql ? `\n  \`\`\`sql\n  ${m.sql.trim().replace(/\n/g, '\n  ')}\n  \`\`\`` : '';
    return `- [${tag}] ${m.text}${sql}`;
  });
  return [
    '<storeleads-memory>',
    'Team memory from earlier StoreLeads questions. "verified" = confirmed several times or by a person;',
    '"candidate" = seen once, double-check before relying on it. Memory never replaces running the query:',
    'numbers always come from a fresh query_sql, insights only add context for their snapshot month.',
    ...lines,
    '</storeleads-memory>',
  ].join('\n');
}
