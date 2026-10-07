import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { z } from 'zod';
import { recall } from './memory.js';
import { formatResult, type RunQuery } from './query.js';
import type { UsageStore } from './store.js';
import type { Actor, TurnTracker } from './turns.js';

export interface McpDeps {
  runQuery: RunQuery;
  tracker: TurnTracker;
  store: UsageStore;
  maxRows: number;
  log?: (msg: string, err?: unknown) => void;
}

const via = z
  .enum(['hook', 'model'])
  .optional()
  .describe('Leave unset. "hook" is used only by the Claude Code plugin hooks.');

function actorOf(server: McpServer, auth?: AuthInfo): Actor {
  const extra = (auth?.extra ?? {}) as { userId?: string; userName?: string };
  return {
    userId: extra.userId ?? 'anonymous',
    userName: extra.userName ?? '',
    client: server.server.getClientVersion()?.name ?? '',
  };
}

export function buildMcpServer(deps: McpDeps): McpServer {
  const log = deps.log ?? ((msg: string, err?: unknown) => console.error(msg, err ?? ''));
  const server = new McpServer(
    { name: 'storeleads-brain', version: '0.1.0' },
    {
      instructions:
        'StoreLeads data (Shopify apps and stores, 24 monthly snapshots Oct 2024 – Sep 2026) plus team memory. ' +
        'For a StoreLeads question: call recall first with the question, run query_sql for every number, and call record ' +
        'once at the end. Internal use only (StoreLeads ToS §2).',
    },
  );

  const conversationOf = (sessionId: string | undefined, actor: Actor) => sessionId ?? `user:${actor.userId}`;

  server.registerTool(
    'recall',
    {
      title: 'Recall team memory',
      description:
        'Call FIRST for every StoreLeads question, with the question as the person wrote it. Returns what the team ' +
        'already learned that is relevant: which app_key a name means, working SQL for this kind of question, past ' +
        'errors and their fixes, corrections people made, and this person\'s preferences. Skip it only if a ' +
        '<storeleads-memory> block for this same question is already in the conversation.',
      inputSchema: {
        question: z.string().describe('The question, verbatim.'),
        via,
        client_session: z.string().optional().describe('Leave unset.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ question, via: v, client_session }, extra) => {
      const actor = actorOf(server, extra.authInfo);
      const conversation = conversationOf(extra.sessionId, actor);
      const source = v === 'hook' ? 'hook' : 'tool';
      deps.tracker.startTurn(conversation, actor, question, source, client_session ?? '');
      try {
        const { memories, text } = await recall(deps.store, question, actor.userId);
        deps.tracker.addRecalled(conversation, memories.map((m) => m.id));
        // From the UserPromptSubmit hook: Claude Code only adds an mcp_tool hook's result to the context when it
        // is hook JSON with additionalContext (plain text is dropped). Say nothing when there is nothing.
        if (source === 'hook') {
          const out = text ? JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: text } }) : '';
          return { content: [{ type: 'text', text: out }] };
        }
        return { content: [{ type: 'text', text: text || 'No team memory matches this question yet.' }] };
      } catch (err) {
        log('recall failed', err);
        return { content: [{ type: 'text', text: source === 'hook' ? '' : 'Team memory is unavailable right now; go on without it.' }] };
      }
    },
  );

  server.registerTool(
    'query_sql',
    {
      title: 'Run a StoreLeads SQL query',
      description:
        'Run one read-only ClickHouse SELECT on the StoreLeads `slim` database (tables app_dim, app_month_agg, app_month, ' +
        `store_dim, store_app, store_month, category_month_agg) and get the rows back. At most ${deps.maxRows} rows ` +
        'are returned. Use the recipes from the StoreLeads skill; let SQL do the arithmetic.',
      inputSchema: { sql: z.string().describe('One SELECT or WITH … SELECT statement.') },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ sql }, extra) => {
      const actor = actorOf(server, extra.authInfo);
      const result = await deps.runQuery(sql);
      deps.tracker.addQuery(conversationOf(extra.sessionId, actor), actor, {
        sql,
        ok: result.ok,
        error: result.error,
        rows: result.rowCount,
        ms: result.ms,
      });
      return { content: [{ type: 'text', text: formatResult(result, deps.maxRows) }], isError: !result.ok };
    },
  );

  server.registerTool(
    'record',
    {
      title: 'Record the answer',
      description:
        'Call ONCE as the last step of every StoreLeads answer, right before you write the final reply. Pass the ' +
        'answer you are about to give (its key numbers and conclusion, with the snapshot month), how it went, and — ' +
        'if the person wanted something the data cannot answer — what data was missing. The team uses this to learn ' +
        'which questions people ask and what to add.',
      inputSchema: {
        answer: z.string().describe('The answer: key numbers with their month, the conclusion, caveats said.'),
        outcome: z
          .enum(['answered', 'partial', 'asked_back', 'failed', 'refused'])
          .optional()
          .describe('answered | partial | asked_back (you asked them to clarify) | failed | refused (licence).'),
        data_gap: z.string().optional().describe('What data would have been needed, if any was missing.'),
        via,
        client_session: z.string().optional().describe('Leave unset.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ answer, outcome, data_gap, via: v, client_session }, extra) => {
      const actor = actorOf(server, extra.authInfo);
      const source = v === 'hook' ? 'hook' : 'tool';
      deps.tracker.record(conversationOf(extra.sessionId, actor), actor, {
        answer,
        source,
        outcome,
        dataGap: data_gap,
        clientSession: client_session,
      });
      // Stop-hook output is parsed by Claude Code; plain empty text keeps it a no-op.
      return { content: [{ type: 'text', text: source === 'hook' ? '' : 'Recorded.' }] };
    },
  );

  return server;
}
