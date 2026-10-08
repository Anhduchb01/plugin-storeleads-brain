import { randomUUID } from 'node:crypto';
import type { QueryLog, Source, TurnRecord } from './store.js';

// Pairs a question with the queries run for it and the answer given, per conversation (MCP session).
//
// Two ways a turn gets its ends:
// - Claude Code with the plugin hooks: UserPromptSubmit calls recall(via=hook) with the verbatim prompt,
//   Stop calls record(via=hook) with the verbatim answer. Deterministic.
// - Everywhere else (claude.ai, Desktop chat): the skill asks Claude to call recall first and record last.
//   Not guaranteed, so query_sql opens a turn on its own and idle turns are closed by sweep().
//
// A turn is kept only if it touched StoreLeads: it ran a query, or Claude called record itself.
// Hooks fire on every prompt in every project, so a hook-only turn with no query is dropped unseen —
// unless logAll is on, which keeps every prompt the hooks see.

export interface Actor {
  userId: string;
  userName: string;
  client: string;
}

interface OpenTurn extends TurnRecord {
  lastActivity: number;
  recordedByModel: boolean;
}

export interface TurnTrackerOptions {
  idleMs: number;
  /** Keep every turn that has a question or an answer, StoreLeads or not (LOG_ALL_TURNS=1). */
  logAll?: boolean;
  persist: (turn: TurnRecord) => Promise<void>;
  now?: () => number;
  log?: (msg: string, err?: unknown) => void;
}

const MAX_REMEMBERED_CONVERSATIONS = 10_000;

export class TurnTracker {
  private readonly open = new Map<string, OpenTurn>();
  private readonly lastPersisted = new Map<string, string>();
  private readonly pending = new Set<Promise<void>>();
  private readonly now: () => number;
  private readonly log: (msg: string, err?: unknown) => void;

  constructor(private readonly opts: TurnTrackerOptions) {
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? ((msg, err) => console.error(msg, err ?? ''));
  }

  /** Called by recall. Returns the id of the turn the question belongs to. */
  startTurn(conversation: string, actor: Actor, question: string, source: Source, clientSession = ''): string {
    const existing = this.open.get(conversation);
    if (existing && source === 'tool' && existing.questionSource === 'hook' && !existing.queries.length && !existing.answer) {
      // Claude called recall itself after the hook already opened this turn: keep the verbatim prompt.
      existing.lastActivity = this.now();
      return existing.turnId;
    }
    if (existing) this.finalize(conversation);
    return this.openTurn(conversation, actor, question, source, clientSession).turnId;
  }

  addQuery(conversation: string, actor: Actor, query: QueryLog): string {
    const turn = this.open.get(conversation) ?? this.openTurn(conversation, actor, '', 'none', '');
    turn.queries.push(query);
    turn.lastActivity = this.now();
    return turn.turnId;
  }

  addRecalled(conversation: string, ids: string[]) {
    const turn = this.open.get(conversation);
    if (turn) for (const id of ids) if (!turn.recalledIds.includes(id)) turn.recalledIds.push(id);
  }

  /** Called by record. Returns the turn id the answer was attached to, or undefined if it was ignored. */
  record(
    conversation: string,
    actor: Actor,
    input: { answer: string; source: Source; outcome?: string; dataGap?: string; learned?: string; clientSession?: string },
  ): string | undefined {
    let turn = this.open.get(conversation);
    if (!turn) {
      // A Stop hook with nothing open: the turn never touched StoreLeads.
      if (input.source !== 'tool') return undefined;
      turn = this.openTurn(conversation, actor, '', 'none', input.clientSession ?? '');
    }
    if (input.source === 'hook' || !turn.answer) {
      turn.answer = input.answer;
      turn.answerSource = input.source;
    }
    if (input.outcome) turn.modelOutcome = input.outcome;
    if (input.dataGap) turn.modelDataGap = input.dataGap;
    if (input.learned) turn.modelLearned = input.learned;
    if (input.clientSession && !turn.clientSession) turn.clientSession = input.clientSession;
    turn.lastActivity = this.now();
    if (input.source === 'tool') turn.recordedByModel = true;

    const id = turn.turnId;
    // With hooks on, the Stop hook brings the verbatim answer after Claude's own record call: wait for it.
    const waitForStopHook = input.source === 'tool' && turn.questionSource === 'hook';
    if (!waitForStopHook) this.finalize(conversation);
    return id;
  }

  /** Close turns with no activity for idleMs (Claude never called record, or the user left). */
  sweep() {
    const cutoff = this.now() - this.opts.idleMs;
    for (const [conversation, turn] of this.open) if (turn.lastActivity < cutoff) this.finalize(conversation);
  }

  endConversation(conversation: string) {
    if (this.open.has(conversation)) this.finalize(conversation);
    this.lastPersisted.delete(conversation);
  }

  /** Close everything (shutdown). */
  closeAll() {
    for (const conversation of [...this.open.keys()]) this.finalize(conversation);
  }

  /** Wait for in-flight persist calls (tests, shutdown). */
  async flush() {
    await Promise.all([...this.pending]);
  }

  openTurnId(conversation: string): string | undefined {
    return this.open.get(conversation)?.turnId;
  }

  private openTurn(conversation: string, actor: Actor, question: string, source: Source, clientSession: string) {
    const t = this.now();
    const turn: OpenTurn = {
      turnId: randomUUID(),
      startedAt: new Date(t),
      endedAt: new Date(t),
      userId: actor.userId,
      userName: actor.userName,
      client: actor.client,
      conversation,
      clientSession,
      previousTurnId: '',
      question,
      questionSource: source,
      answer: '',
      answerSource: 'none',
      modelOutcome: '',
      modelDataGap: '',
      modelLearned: '',
      queries: [],
      recalledIds: [],
      lastActivity: t,
      recordedByModel: false,
    };
    this.open.set(conversation, turn);
    return turn;
  }

  private finalize(conversation: string) {
    const turn = this.open.get(conversation);
    if (!turn) return;
    this.open.delete(conversation);
    const touchedStoreLeads = turn.queries.length > 0 || turn.recordedByModel;
    if (!touchedStoreLeads && !(this.opts.logAll && (turn.question || turn.answer))) return;

    const { lastActivity: _a, recordedByModel: _r, ...record } = turn;
    record.endedAt = new Date(this.now());
    record.previousTurnId = this.lastPersisted.get(conversation) ?? '';
    this.lastPersisted.delete(conversation);
    this.lastPersisted.set(conversation, record.turnId);
    if (this.lastPersisted.size > MAX_REMEMBERED_CONVERSATIONS) {
      this.lastPersisted.delete(this.lastPersisted.keys().next().value!);
    }

    const p = this.opts
      .persist(record)
      .catch((err) => this.log(`persist turn ${record.turnId} failed`, err))
      .finally(() => this.pending.delete(p));
    this.pending.add(p);
  }
}
