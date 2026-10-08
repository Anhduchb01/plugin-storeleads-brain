import { keysFor } from './keys.js';
import { applyMemories, type MemoryCandidate } from './distiller.js';
import type { TurnRecord, UsageStore } from './store.js';

// Claude's own `learned` lines (from record) become memories right away, without the distiller:
// "Preference: …" lines are kept for that person only, every other line is a team note. Each starts as a
// candidate; the same line from 3 different turns makes it verified (applyMemories).

export function learnedCandidates(learned: string): MemoryCandidate[] {
  const out: MemoryCandidate[] = [];
  for (const raw of learned.split(/\n|;\s+/)) {
    const line = raw.replace(/^[-*•\s]+/, '').trim();
    if (line.length < 8) continue;
    const pref = /^preference\s*:\s*/i.exec(line);
    const text = pref ? line.slice(pref[0].length) : line;
    const keys = keysFor(text).filter((k) => !k.includes(' ') || pref);
    out.push({
      kind: pref ? 'preference' : 'note',
      dedupe_key: text.toLowerCase().replace(/\s+/g, ' ').slice(0, 300),
      keys: pref ? ['preference', ...keys] : keys,
      text,
      sql: null,
      snapshot_month: null,
    });
  }
  return out;
}

export async function fileLearned(store: UsageStore, turn: TurnRecord): Promise<string[]> {
  if (!turn.modelLearned.trim()) return [];
  return applyMemories(store, turn, learnedCandidates(turn.modelLearned));
}
