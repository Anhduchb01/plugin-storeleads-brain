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
        'StoreLeads Brain is the team\'s shared second brain. Every question anyone asks, and what answering it taught, ' +
        'is kept so that the next person who asks something similar — a teammate, or the same person next week — gets ' +
        'a faster, better answer: the right app_key straight away, SQL that already worked, a mistake not repeated, a ' +
        'correction someone made, their own preferences. It only works if every turn goes in. So on EVERY message the ' +
        'person sends — any topic, StoreLeads or not, follow-ups included — call `recall` first with their message ' +
        'verbatim and use what it returns, and call `record` once as the last step before your reply, with that reply ' +
        'and, in `learned`, anything worth remembering for next time. Do this even when no other tool is needed and ' +
        'even when you answer from general knowledge. For Shopify app / store numbers use `query_sql` (StoreLeads ' +
        'data, 24 monthly snapshots Oct 2024 – Sep 2026). Internal use only (StoreLeads ToS §2).',
    },
  );

  const conversationOf = (sessionId: string | undefined, actor: Actor) => sessionId ?? `user:${actor.userId}`;

  server.registerTool(
    'recall',
    {
      title: 'Recall team memory',
      description:
        'Call FIRST on every message the person sends, whatever the topic, with their message verbatim. Asks the ' +
        'team\'s second brain what it already knows that is relevant — which app_key a name means, working SQL for ' +
        'this kind of question, past errors and their fixes, corrections people made, this person\'s preferences — ' +
        'and logs the question. Use what comes back. Often returns nothing for non-StoreLeads topics; call it anyway.',
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
        'Call ONCE as the last step of every reply, whatever the topic, right before you write it. Saves the turn ' +
        'to the team\'s second brain: the reply you are about to give (in full when short; otherwise its key points, ' +
        'numbers with their snapshot month, and conclusion), how it went, what data was missing if the StoreLeads ' +
        'data could not answer, and what is worth remembering for next time. This is how the next person gets a ' +
        'better answer.',
      inputSchema: {
        answer: z.string().describe('The reply: in full when short, else key points, numbers with their month, conclusion.'),
        outcome: z
          .enum(['answered', 'partial', 'asked_back', 'failed', 'refused'])
          .optional()
          .describe('answered | partial | asked_back (you asked them to clarify) | failed | refused (licence).'),
        data_gap: z.string().optional().describe('What data would have been needed, if any was missing.'),
        learned: z
          .string()
          .optional()
          .describe(
            'Worth remembering for next time, one short line each: which app_key a name turned out to mean, a SQL ' +
              'error and its fix, a correction the person made, how they like answers. Leave out numbers and store lists.',
          ),
        via,
        client_session: z.string().optional().describe('Leave unset.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ answer, outcome, data_gap, learned, via: v, client_session }, extra) => {
      const actor = actorOf(server, extra.authInfo);
      const source = v === 'hook' ? 'hook' : 'tool';
      deps.tracker.record(conversationOf(extra.sessionId, actor), actor, {
        answer,
        source,
        outcome,
        dataGap: data_gap,
        learned,
        clientSession: client_session,
      });
      // Stop-hook output is parsed by Claude Code; plain empty text keeps it a no-op.
      return { content: [{ type: 'text', text: source === 'hook' ? '' : 'Recorded.' }] };
    },
  );

  return server;
}
