import { mkdtempSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { StaticTokenVerifier, parseTokens } from '../src/auth/static.js';

describe('token auth', () => {
  it('parses inline pairs and file lines with names and comments', () => {
    const t = parseTokens('a:U_A', '# people\nbbb U_B Nguyễn Văn B\n\nccc U_C # note\n');
    expect(t.get('a')).toEqual({ userId: 'U_A', userName: 'U_A' });
    expect(t.get('bbb')).toEqual({ userId: 'U_B', userName: 'Nguyễn Văn B' });
    expect(t.get('ccc')).toEqual({ userId: 'U_C', userName: 'U_C' });
  });

  it('drops short tokens and picks up file changes without a restart', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'brain-')), 'tokens.txt');
    const long = 'x'.repeat(40);
    writeFileSync(file, `short U_S\n${long} U_L Long\n`);
    const v = new StaticTokenVerifier({ inline: '', file, minLength: 32 });
    await expect(v.verifyAccessToken('short')).rejects.toThrow();
    expect((await v.verifyAccessToken(long)).extra).toMatchObject({ userId: 'U_L', userName: 'Long' });

    const added = 'y'.repeat(40);
    writeFileSync(file, `${long} U_L Long\n${added} U_N New\n`);
    utimesSync(file, new Date(), new Date(Date.now() + 10_000));
    (v as unknown as { lastCheck: number }).lastCheck = 0;
    expect((await v.verifyAccessToken(added)).extra).toMatchObject({ userId: 'U_N' });
  });
});
