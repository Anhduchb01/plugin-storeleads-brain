import { describe, expect, it } from 'vitest';
import {
  Distiller,
  PROMOTE_AT_EVIDENCE,
  applyFeedback,
  applyMemories,
  buildTurnMessage,
  sanitizeCandidate,
  type DistillOutput,
  type MemoryCandidate,
} from '../src/distiller.js';
import { recall } from '../src/memory.js';
import { InMemoryUsageStore, type TurnRecord } from '../src/store.js';

let n = 0;
function turn(over: Partial<TurnRecord> = {}): TurnRecord {
  n++;
  return {
    turnId: `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`,
    startedAt: new Date(),
    endedAt: new Date(),
    userId: 'U1',
    userName: 'An',
    client: 'claude-ai',
    conversation: 'c1',
    clientSession: '',
    previousTurnId: '',
    question: 'How many stores run Yotpo?',
    questionSource: 'tool',
    answer: 'Yotpo: 12.943 stores (Sep 2026)',
    answerSource: 'tool',
    modelOutcome: '',
    modelDataGap: '',
    queries: [{ sql: "SELECT ... WHERE app_key = 'yotpo-product-reviews'", ok: true, error: '', rows: 1, ms: 9 }],
    recalledIds: [],
    ...over,
  };
}

const alias: MemoryCandidate = {
  kind: 'alias',
  dedupe_key: 'alias:yotpo',
  keys: ['Yotpo'],
  text: '"Yotpo" means app_key yotpo-product-reviews (reviews), not Yotpo SMS.',
  sql: null,
  snapshot_month: null,
};

const output = (over: Partial<DistillOutput> = {}): DistillOutput => ({
  use_case: 'app-size',
  outcome: 'answered',
  data_gap: null,
  apps: ['yotpo-product-reviews'],
  categories: [],
  countries: [],
  months: [23],
  feedback_on_previous: 'none',
  memories: [alias],
  ...over,
});

describe('memories', () => {
  it('a candidate is promoted after enough distinct turns, then recalled by a later question', async () => {
    const store = new InMemoryUsageStore();
    const t1 = turn();
    await applyMemories(store, t1, [alias]);
    await applyMemories(store, t1, [alias]); // same turn twice is one piece of evidence
    let [m] = store.memories.values();
    expect(m).toMatchObject({ status: 'candidate', evidence: 1, scope: 'team' });

    for (let i = 1; i < PROMOTE_AT_EVIDENCE; i++) await applyMemories(store, turn(), [alias]);
    [m] = store.memories.values();
    expect(m).toMatchObject({ status: 'verified', evidence: PROMOTE_AT_EVIDENCE });

    const { text } = await recall(store, 'Yotpo tăng trưởng thế nào?', 'U2');
    expect(text).toContain('<storeleads-memory>');
    expect(text).toContain('[alias, verified]');
  });

  it('preferences are private to their author', async () => {
    const store = new InMemoryUsageStore();
    await applyMemories(store, turn(), [
      alias,
      { kind: 'preference', dedupe_key: 'pref:plus-only', keys: ['plus'], text: 'Wants Plus stores only.', sql: null, snapshot_month: null },
    ]);
    expect((await recall(store, 'yotpo size', 'U1')).text).toContain('Wants Plus stores only.');
    expect((await recall(store, 'yotpo size', 'U2')).text).not.toContain('Wants Plus stores only.');
  });

  it('drops store lists, insights without a snapshot, and empty keys', () => {
    expect(
      sanitizeCandidate({ ...alias, kind: 'insight', text: 'Top stores: a.com, b.com, c.myshopify.com', snapshot_month: 23 }),
    ).toBeNull();
    expect(sanitizeCandidate({ ...alias, kind: 'insight', snapshot_month: null })).toBeNull();
    expect(sanitizeCandidate({ ...alias, keys: ['  '] })).toBeNull();
    expect(sanitizeCandidate({ ...alias, text: 'judge.me is not yotpo' })).not.toBeNull();
  });

  it('a correction on the next turn rejects what the previous turn filed', async () => {
    const store = new InMemoryUsageStore();
    const t1 = turn();
    const ids = await applyMemories(store, t1, [alias]);
    await store.insertDistill({ turnId: t1.turnId, distilledAt: new Date(), useCase: 'app-size', outcome: 'answered', dataGap: '', apps: [], categories: [], countries: [], months: [], feedbackOnPrevious: 'none', model: 'x', memoryIds: ids });
    await applyFeedback(store, t1.turnId, 'corrected');
    expect(store.memories.get(ids[0])?.status).toBe('rejected');
    expect((await recall(store, 'yotpo', 'U1')).text).toBe('');
  });
});

describe('Distiller', () => {
  it('labels each turn, files memories, and passes the previous turn for feedback', async () => {
    const store = new InMemoryUsageStore();
    const seenPrevious: (string | undefined)[] = [];
    const distiller = new Distiller({
      store,
      model: 'test-model',
      classify: async (t, previous) => {
        seenPrevious.push(previous?.question);
        return t.question.startsWith('Sai')
          ? output({ feedback_on_previous: 'corrected', memories: [], outcome: 'answered' })
          : output();
      },
    });
    const t1 = turn();
    const t2 = turn({ question: 'Sai rồi, ý mình là Yotpo SMS', previousTurnId: t1.turnId });
    distiller.enqueue(t1);
    distiller.enqueue(t2);
    await distiller.drained();

    expect(store.distills.get(t1.turnId)).toMatchObject({ useCase: 'app-size', months: [23], model: 'test-model' });
    expect(seenPrevious).toEqual([undefined, t1.question]);
    const [m] = store.memories.values();
    expect(m.status).toBe('rejected');
  });

  it('builds a message that marks missing parts instead of inventing them', () => {
    const msg = JSON.parse(buildTurnMessage(turn({ question: '', answer: '' })));
    expect(msg.question).toMatch(/not captured/);
    expect(msg.answer).toBe('(not captured)');
    expect(msg.previous_turn).toBeNull();
  });
});
