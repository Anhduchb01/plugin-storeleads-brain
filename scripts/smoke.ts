// End-to-end check against a running server: recall → query_sql → record, as Claude would.
//   BRAIN_URL=http://localhost:8080 BRAIN_TOKEN=<token> npx tsx scripts/smoke.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const url = new URL('/mcp', process.env.BRAIN_URL ?? 'http://localhost:8080');
const client = new Client({ name: 'brain-smoke', version: '1.0.0' });
await client.connect(
  new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization: `Bearer ${process.env.BRAIN_TOKEN}` } } }),
);
const show = (label: string, r: unknown) =>
  console.log(`--- ${label}\n${(r as { content: { text: string }[] }).content.map((c) => c.text).join('\n')}`);

show('recall', await client.callTool({ name: 'recall', arguments: { question: 'Yotpo có bao nhiêu store?' } }));
show(
  'query_sql (recipe 0)',
  await client.callTool({
    name: 'query_sql',
    arguments: {
      sql: `SELECT d.app_key, d.name, d.vendor_name, d.primary_category, sum(a.stores) AS stores_now
FROM slim.app_dim d LEFT JOIN slim.app_month_agg a ON a.app_id = d.app_id AND a.month = 23
WHERE d.name ILIKE '%yotpo%' OR d.app_key ILIKE '%yotpo%' GROUP BY 1, 2, 3, 4 ORDER BY stores_now DESC LIMIT 10`,
    },
  }),
);
show('query_sql (blocked)', await client.callTool({ name: 'query_sql', arguments: { sql: 'SELECT * FROM usage.qa_log' } }));
show('record', await client.callTool({ name: 'record', arguments: { answer: 'Yotpo Product Reviews: 4.000 store (9/2026).', outcome: 'answered' } }));
await client.close();
