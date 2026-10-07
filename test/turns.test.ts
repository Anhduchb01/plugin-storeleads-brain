import { describe, expect, it } from 'vitest';
import type { QueryLog, TurnRecord } from '../src/store.js';
import { TurnTracker } from '../src/turns.js';

const actor = { userId: 'U1', userName: 'An', client: 'claude-code' };
const q = (sql = 'SELECT 1'): QueryLog => ({ sql, ok: true, error: '', rows: 1, ms: 5 });

function setup(logAll = false) {
  let now = 1_000_000;
  const saved: TurnRecord[] = [];
  const tracker = new TurnTracker({
    idleMs: 60_000,
    logAll,
    now: () => now,
    persist: async (t) => {
      saved.push(t);
    },
  });
  return { tracker, saved, tick: (ms: number) => (now += ms) };
}

describe('TurnTracker', () => {
  it('Claude Code with hooks: verbatim prompt + queries + verbatim answer make one turn', async () => {
    const { tracker, saved } = setup();
    tracker.startTurn('s1', actor, 'Klaviyo có bao nhiêu store?', 'hook', 'cc-1');
    tracker.startTurn('s1', actor, 'how many stores klaviyo', 'tool'); // Claude also called recall
    tracker.addQuery('s1', actor, q());
    tracker.record('s1', actor, { answer: 'summary', source: 'tool', outcome: 'answered' });
    expect(saved).toHaveLength(0); // waits for the Stop hook
    tracker.record('s1', actor, { answer: 'Full answer text', source: 'hook' });
    await tracker.flush();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      question: 'Klaviyo có bao nhiêu store?',
      questionSource: 'hook',
      answer: 'Full answer text',
      answerSource: 'hook',
      modelOutcome: 'answered',
      clientSession: 'cc-1',
    });
    expect(saved[0].queries).toHaveLength(1);
  });

  it('drops hook-only turns that never touched StoreLeads', async () => {
    const { tracker, saved } = setup();
    tracker.startTurn('s1', actor, 'refactor this function', 'hook');
    tracker.record('s1', actor, { answer: 'done', source: 'hook' });
    await tracker.flush();
    expect(saved).toHaveLength(0);
  });

  it('LOG_ALL_TURNS keeps hook-only turns too', async () => {
    const { tracker, saved } = setup(true);
    tracker.startTurn('s1', actor, 'refactor this function', 'hook');
    tracker.record('s1', actor, { answer: 'done', source: 'hook' });
    await tracker.flush();
    expect(saved[0]).toMatchObject({ question: 'refactor this function', answer: 'done', queries: [] });
  });

  it('web: recall + query + record by the model', async () => {
    const { tracker, saved } = setup();
    tracker.startTurn('w1', actor, 'Who competes with Loox?', 'tool');
    tracker.addQuery('w1', actor, q());
    tracker.record('w1', actor, { answer: 'Judge.me leads', source: 'tool' });
    await tracker.flush();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ question: 'Who competes with Loox?', answer: 'Judge.me leads', answerSource: 'tool' });
  });

  it('web: a data-gap answer with no query is kept because Claude recorded it', async () => {
    const { tracker, saved } = setup();
    tracker.startTurn('w1', actor, 'Doanh thu của Klaviyo năm 2023?', 'tool');
    tracker.record('w1', actor, { answer: 'No data before Oct 2024', source: 'tool', dataGap: 'data before Oct 2024' });
    await tracker.flush();
    expect(saved[0]).toMatchObject({ queries: [], modelDataGap: 'data before Oct 2024' });
  });

  it('web: Claude skipped recall and record — query opens the turn, sweep closes it', async () => {
    const { tracker, saved, tick } = setup();
    tracker.addQuery('w1', actor, q());
    tick(30_000);
    tracker.sweep();
    expect(saved).toHaveLength(0);
    tick(61_000);
    tracker.sweep();
    await tracker.flush();
    expect(saved[0]).toMatchObject({ question: '', questionSource: 'none', answerSource: 'none' });
  });

  it('links turns of one conversation through previousTurnId', async () => {
    const { tracker, saved } = setup();
    for (const question of ['first', 'second']) {
      tracker.startTurn('w1', actor, question, 'tool');
      tracker.addQuery('w1', actor, q());
      tracker.record('w1', actor, { answer: question, source: 'tool' });
    }
    await tracker.flush();
    expect(saved[0].previousTurnId).toBe('');
    expect(saved[1].previousTurnId).toBe(saved[0].turnId);
  });

  it('a new hook prompt closes the previous turn', async () => {
    const { tracker, saved } = setup();
    tracker.startTurn('s1', actor, 'one', 'hook');
    tracker.addQuery('s1', actor, q());
    tracker.startTurn('s1', actor, 'two', 'hook');
    await tracker.flush();
    expect(saved.map((t) => t.question)).toEqual(['one']);
  });
});
