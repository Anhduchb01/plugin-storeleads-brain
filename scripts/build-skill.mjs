// Builds the StoreLeads skill for the brain connector (claude.ai upload, or the plugin once it switches over):
// the Grafana skill with its connector lines rewritten, plus the memory protocol section.
//   node scripts/build-skill.mjs            → dist/skill/storeleads/ and dist/storeleads-skill.zip
// Run from the repo root. skill-src/ is a copy of the plugin's skill (see skill-src/README.md). Fails if a line it rewrites has changed upstream.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const SRC = 'skill-src/storeleads-grafana';
const OUT = 'dist/skill/storeleads';

const rewrites = [
  ['name: storeleads-grafana', 'name: storeleads'],
  ['allowed-tools: Read, mcp__plugin_storeleads_grafana, mcp__grafana', 'allowed-tools: Read, mcp__plugin_storeleads_brain'],
  [
    'through the Grafana MCP (storedata.ecvision.ai, datasource "StoreLeads ClickHouse", database slim)',
    'through the StoreLeads Brain connector (database slim, with team memory)',
  ],
  ['# StoreLeads through the Grafana MCP', '# StoreLeads through the StoreLeads Brain connector'],
  [
    'Query it with the Grafana MCP tool `query_sql`, datasource uid `storeleads-ch`,\ndatabase `slim`. Read-only.',
    'Query it with the connector tool `query_sql` (database `slim`). Read-only.\nStart every question with `recall` and end it with `record` (see Team memory at the end).',
  ],
  ['with `query_sql` (datasource uid `storeleads-ch`) and answer', 'with `query_sql` and answer'],
];

let skill = readFileSync(`${SRC}/SKILL.md`, 'utf8');
for (const [from, to] of rewrites) {
  if (!skill.includes(from)) throw new Error(`SKILL.md no longer contains:\n${from}\nUpdate scripts/build-skill.mjs.`);
  skill = skill.replace(from, to);
}
skill += readFileSync('skill-src/memory-protocol.md', 'utf8');

rmSync('dist/skill', { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/SKILL.md`, skill);
cpSync(`${SRC}/references`, `${OUT}/references`, { recursive: true });
rmSync('dist/storeleads-skill.zip', { force: true });
execFileSync('zip', ['-qr', '../storeleads-skill.zip', 'storeleads'], { cwd: 'dist/skill' });
console.log(`wrote ${OUT}/ and dist/storeleads-skill.zip`);
