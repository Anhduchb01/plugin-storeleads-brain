import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { normalizeKeys } from './keys.js';
import { MEMORY_KINDS, memoryId, type Distill, type Memory, type TurnRecord, type UsageStore } from './store.js';

// Turns a logged question → answer into (1) labels for analysis (use case, outcome, data gap, entities)
// and (2) small reusable memories. Runs in the background, one turn at a time, after the turn is logged.

/** Mirrors the ### ids in plugins/storeleads/skills/storeleads-grafana/references/use-cases.md. */
export const USE_CASES: Record<string, string> = {
  'app-size': 'install base now, Plus share, rank among all apps',
  'app-competitors': 'same-category competitors, now vs N months ago',
  'app-brief': 'one-page competitor brief on one app (/storeleads:competitor-brief)',
  'app-stack': 'what else stores running app(s) X also run',
  gap: 'crowded categories with a weak or fragmented leader',
  'idea-check': 'is a new app idea worth building (/storeleads:app-idea-check)',
  newcomers: 'recently listed apps gaining stores in a category',
  'category-scan': 'scan of one category: leaders, momentum, newcomers (/storeleads:category-scan)',
  'app-growth': 'growth of one or more apps over N months (/storeleads:growth-check)',
  fastest: 'fastest-growing apps overall, on Plus, or in a group',
  'churn-where': 'where stores go after dropping an app',
  'churn-postmortem': 'churn post-mortem for one app (/storeleads:churn-postmortem)',
  countries: 'countries and reach index of an app',
  'plus-gap': 'Plus stores with no app in a category (/storeleads:plus-gap)',
  'new-stores': 'what stores created in the last 90 days run',
  themes: 'themes used by an app’s merchants',
  report: 'turn answers into a one-page HTML report',
  'store-list': 'capped list of stores matching filters',
};

/** A candidate becomes verified once this many distinct turns produced it (or a person confirmed it). */
export const PROMOTE_AT_EVIDENCE = 3;

const MemorySchema = z.object({
  kind: z.enum(MEMORY_KINDS),
  dedupe_key: z.string(),
  keys: z.array(z.string()),
  text: z.string(),
  sql: z.string().nullable(),
  snapshot_month: z.number().int().nullable(),
});

export const DistillSchema = z.object({
  use_case: z.string(),
  outcome: z.enum(['answered', 'partial', 'asked_back', 'failed', 'refused']),
  data_gap: z.string().nullable(),
  apps: z.array(z.string()),
  categories: z.array(z.string()),
  countries: z.array(z.string()),
  months: z.array(z.number().int()),
  feedback_on_previous: z.enum(['none', 'confirmed', 'corrected', 'unclear']),
  memories: z.array(MemorySchema),
});
export type DistillOutput = z.infer<typeof DistillSchema>;
export type MemoryCandidate = z.infer<typeof MemorySchema>;

export const SYSTEM_PROMPT = `You review one question → answer turn from Qikify's internal StoreLeads assistant and file it.

Background: the assistant answers questions about Shopify apps and stores by running ClickHouse SQL on the \`slim\`
database (24 monthly snapshots, month 0 = Oct 2024 … month 23 = Sep 2026, the latest). Apps are identified by
\`app_key\`; names collide, so resolving a name to an app_key is a real step. The team uses what you file in two ways:
labels drive a dashboard of what people ask and where the assistant falls short; memories are shown to the assistant
on later, similar questions.

Labels:
- use_case: one id from this catalogue, or "new:<3-6 word label>" when none fits:
${Object.entries(USE_CASES)
  .map(([id, desc]) => `  ${id}: ${desc}`)
  .join('\n')}
- outcome: answered (question fully answered from data) · partial (some of it) · asked_back (assistant asked the person
  to clarify instead of answering) · failed (queries errored or no usable answer) · refused (licence or policy refusal).
- data_gap: when the person wanted something the data cannot answer (a field, a period before Oct 2024, revenue per
  app, review text, App Store ranking …), say in one short line what data would have been needed. Otherwise null.
- apps / categories / countries: names or app_keys the question is about. months: snapshot numbers 0-23 it is about.
- feedback_on_previous: what this question says about the PREVIOUS answer in the same conversation (given below when
  there is one): "confirmed" (thanks / that's right / builds on it), "corrected" (says it was wrong or picked the wrong
  app), "unclear", or "none" (no previous turn or no signal).

Memories — file only what will save a later turn a mistake or a step. Each needs a dedupe_key that will be identical
the next time the same fact comes up (e.g. "alias:yotpo", "fix:correlated-subquery-alias", "query:plus-share-by-country"),
keys (the words a later question would contain: app names, category names, topic words — lowercase), and text (one or
two plain sentences, written for the assistant). Kinds:
- alias: which app_key a name or brand means for this team, and which look-alikes it is not. Only when the SQL shows the
  resolution and the person did not object.
- query: a working SQL for a question shape no skill recipe covers. Include sql. Not for plain recipe runs.
- fix: a query error and the change that fixed it (both visible in this turn's queries). Include the fixed sql.
- correction: something the person corrected about the data, a definition, or how to answer.
- insight: a conclusion about the market tied to one snapshot (snapshot_month required), e.g. a category's leader share.
- preference: how this person likes answers (always Plus only, a country focus, a format).
Never file: store domains, merchant names or store lists; bare numbers without their snapshot month; anything the
answer itself flagged as uncertain; general knowledge any analyst would know. Most turns produce zero or one memory.`;

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n[… ${text.length - max} more characters not shown]`;
}

export function buildTurnMessage(turn: TurnRecord, previous?: Pick<TurnRecord, 'question' | 'answer'>): string {
  const queries = turn.queries.map((q, i) => ({
    n: i + 1,
    sql: q.sql,
    ok: q.ok,
    error: q.error || undefined,
    rows: q.rows,
  }));
  return JSON.stringify(
    {
      previous_turn: previous
        ? { question: clip(previous.question, 4000), answer: clip(previous.answer, 6000) }
        : null,
      question: turn.question || '(not captured — infer from the queries and the answer)',
      answer: turn.answer ? clip(turn.answer, 60_000) : '(not captured)',
      assistant_reported: { outcome: turn.modelOutcome || null, data_gap: turn.modelDataGap || null },
      queries,
    },
    null,
    1,
  );
}

const DOMAIN_LIKE = /\b[a-z0-9-]+\.(?:com|net|org|co|shop|store|io|us|uk|de|fr|au|ca|myshopify\.com)\b/gi;

/** Server-side guard on what the model proposes; returns null to drop the candidate. */
export function sanitizeCandidate(c: MemoryCandidate): MemoryCandidate | null {
  const text = c.text.trim();
  const keys = normalizeKeys(c.keys);
  if (!text || !c.dedupe_key.trim() || !keys.length) return null;
  // Licence: no store lists. App names like judge.me are fine; three or more domains is a list.
  if ((`${text} ${c.sql ?? ''}`.match(DOMAIN_LIKE) ?? []).length >= 3) return null;
  if (c.kind === 'insight' && (c.snapshot_month === null || c.snapshot_month < 0 || c.snapshot_month > 23)) return null;
  const keepSql = c.kind === 'query' || c.kind === 'fix' || c.kind === 'alias';
  return {
    ...c,
    text,
    keys,
    dedupe_key: c.dedupe_key.trim().toLowerCase(),
    sql: keepSql ? (c.sql?.trim() ?? null) : null,
    snapshot_month: c.kind === 'insight' ? c.snapshot_month : null,
  };
}

/** Insert new memories or add this turn as evidence to existing ones. Returns the ids touched. */
export async function applyMemories(
  store: UsageStore,
  turn: TurnRecord,
  candidates: MemoryCandidate[],
  now = new Date(),
): Promise<string[]> {
  const ids: string[] = [];
  for (const raw of candidates) {
    const c = sanitizeCandidate(raw);
    if (!c) continue;
    const scope = c.kind === 'preference' ? `user:${turn.userId}` : 'team';
    const id = memoryId(scope, c.kind, c.dedupe_key);
    const [existing] = await store.getMemories([id]);
    let next: Memory;
    if (existing) {
      const isNewEvidence = !existing.sourceTurns.includes(turn.turnId);
      const evidence = existing.evidence + (isNewEvidence ? 1 : 0);
      next = {
        ...existing,
        keys: [...new Set([...existing.keys, ...c.keys])].slice(0, 100),
        // A verified text is stable; a candidate takes the latest wording.
        text: existing.status === 'verified' ? existing.text : c.text,
        sql: existing.status === 'verified' && existing.sql ? existing.sql : (c.sql ?? existing.sql),
        snapshotMonth: c.snapshot_month ?? existing.snapshotMonth,
        evidence,
        status:
          existing.status === 'candidate' && evidence >= PROMOTE_AT_EVIDENCE ? 'verified' : existing.status,
        sourceTurns: isNewEvidence ? [...existing.sourceTurns, turn.turnId].slice(-50) : existing.sourceTurns,
        updatedAt: now,
      };
    } else {
      next = {
        id,
        kind: c.kind,
        scope,
        dedupeKey: c.dedupe_key,
        keys: c.keys,
        text: c.text,
        sql: c.sql ?? '',
        snapshotMonth: c.snapshot_month ?? -1,
        status: 'candidate',
        evidence: 1,
        sourceTurns: [turn.turnId],
        createdBy: turn.userId,
        updatedAt: now,
      };
    }
    await store.putMemory(next);
    ids.push(id);
  }
  return ids;
}

/** The person confirmed or corrected the previous answer: promote or reject what that turn filed. */
export async function applyFeedback(
  store: UsageStore,
  previousTurnId: string,
  feedback: DistillOutput['feedback_on_previous'],
  now = new Date(),
) {
  if (!previousTurnId || (feedback !== 'confirmed' && feedback !== 'corrected')) return;
  const previous = await store.getDistill(previousTurnId);
  if (!previous?.memoryIds.length) return;
  for (const m of await store.getMemories(previous.memoryIds)) {
    if (feedback === 'confirmed' && m.status === 'candidate') {
      await store.putMemory({ ...m, status: 'verified', updatedAt: now });
    } else if (feedback === 'corrected' && m.status === 'candidate') {
      await store.putMemory({ ...m, status: 'rejected', updatedAt: now });
    }
  }
}

export type Classifier = (turn: TurnRecord, previous?: TurnRecord) => Promise<DistillOutput | null>;

export function claudeClassifier(client: Anthropic, model: string): Classifier {
  return async (turn, previous) => {
    const response = await client.beta.messages.parse({
      model,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: betaZodOutputFormat(DistillSchema) },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildTurnMessage(turn, previous) }],
    });
    if (response.stop_reason === 'refusal') return null;
    return response.parsed_output ?? null;
  };
}

export interface DistillerOptions {
  store: UsageStore;
  classify: Classifier;
  model: string;
  log?: (msg: string, err?: unknown) => void;
  maxAttempts?: number;
  retryDelayMs?: number;
}

/** Background queue: one turn at a time, retried on transient API errors. */
export class Distiller {
  private readonly queue: { turn: TurnRecord; attempt: number }[] = [];
  private readonly recent = new Map<string, TurnRecord>();
  private running = false;
  private idle: Promise<void> = Promise.resolve();
  private readonly log: (msg: string, err?: unknown) => void;

  constructor(private readonly opts: DistillerOptions) {
    this.log = opts.log ?? ((msg, err) => console.error(msg, err ?? ''));
  }

  enqueue(turn: TurnRecord) {
    this.remember(turn);
    this.queue.push({ turn, attempt: 0 });
    if (!this.running) this.idle = this.drain();
  }

  /** Resolves when the queue is empty (tests, shutdown). */
  async drained() {
    while (this.running || this.queue.length) await this.idle;
  }

  private remember(turn: TurnRecord) {
    this.recent.set(turn.turnId, turn);
    if (this.recent.size > 2000) this.recent.delete(this.recent.keys().next().value!);
  }

  private async drain() {
    this.running = true;
    try {
      while (this.queue.length) {
        const job = this.queue.shift()!;
        try {
          await this.process(job.turn);
        } catch (err) {
          const transient =
            err instanceof Anthropic.RateLimitError ||
            err instanceof Anthropic.InternalServerError ||
            err instanceof Anthropic.APIConnectionError;
          if (transient && job.attempt + 1 < (this.opts.maxAttempts ?? 3)) {
            this.log(`distill ${job.turn.turnId}: transient error, retrying`, err);
            await new Promise((r) => setTimeout(r, (this.opts.retryDelayMs ?? 30_000) * (job.attempt + 1)));
            this.queue.push({ turn: job.turn, attempt: job.attempt + 1 });
          } else {
            this.log(`distill ${job.turn.turnId} failed`, err);
          }
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async process(turn: TurnRecord) {
    const previous = turn.previousTurnId ? this.recent.get(turn.previousTurnId) : undefined;
    const out = await this.opts.classify(turn, previous);
    if (!out) {
      this.log(`distill ${turn.turnId}: no output (refusal or unparseable)`);
      return;
    }
    const now = new Date();
    const memoryIds = await applyMemories(this.opts.store, turn, out.memories, now);
    await applyFeedback(this.opts.store, turn.previousTurnId, out.feedback_on_previous, now);
    const distill: Distill = {
      turnId: turn.turnId,
      distilledAt: now,
      useCase: out.use_case,
      outcome: out.outcome,
      dataGap: out.data_gap ?? '',
      apps: out.apps,
      categories: out.categories,
      countries: out.countries,
      months: out.months.filter((m) => m >= 0 && m <= 23),
      feedbackOnPrevious: out.feedback_on_previous,
      model: this.opts.model,
      memoryIds,
    };
    await this.opts.store.insertDistill(distill);
  }
}
