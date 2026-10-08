import { describe, expect, it } from 'vitest';
import { fileLearned, learnedCandidates } from '../src/learned.js';
import { recall } from '../src/memory.js';
import { InMemoryUsageStore, type TurnRecord } from '../src/store.js';

const turn = (id: string, userId: string, learned: string): TurnRecord => ({
  turnId: id, startedAt: new Date(), endedAt: new Date(), userId, userName: '', client: 'claude-code', conversation: 'c',
  clientSession: '', previousTurnId: '', question: 'q', questionSource: 'tool', answer: 'a', answerSource: 'tool',
  modelOutcome: '', modelDataGap: '', modelLearned: learned, queries: [], recalledIds: [],
});

describe('learned → memory', () => {
  it('splits lines, keeps preferences personal', () => {
    const c = learnedCandidates('- "Yotpo" for this team means yotpo-email-marketing-and-sms\nPreference: wants Plus stores only');
    expect(c.map((m) => m.kind)).toEqual(['note', 'preference']);
    expect(c[0].keys).toContain('yotpo');
  });

  it('a note learned by one person is recalled for a teammate; three turns verify it', async () => {
    const store = new InMemoryUsageStore();
    const line = 'Yotpo for the team usually means yotpo-email-marketing-and-sms, not the reviews app';
    await fileLearned(store, turn('t1', 'U_AN', `${line}\nPreference: answers in English`));

    const forBinh = await recall(store, 'Yotpo tăng trưởng thế nào?', 'U_BINH');
    expect(forBinh.text).toContain('[note, candidate]');
    expect(forBinh.text).not.toContain('answers in English');
    expect((await recall(store, 'anything', 'U_AN')).text).toContain('answers in English');

    await fileLearned(store, turn('t2', 'U_BINH', line));
    await fileLearned(store, turn('t3', 'U_CHI', line));
    expect((await recall(store, 'Yotpo?', 'U_DUNG')).text).toContain('[note, verified]');
  });
});
