import { describe, expect, it } from 'vitest';
import { keysFor, normalizeKeys } from '../src/keys.js';

describe('keys', () => {
  it('strips Vietnamese diacritics and stopwords', () => {
    const keys = keysFor('Klaviyo đang có bao nhiêu store, bao nhiêu % là Shopify Plus?');
    expect(keys).toContain('klaviyo');
    expect(keys).toContain('shopify plus');
    expect(keys).not.toContain('dang');
    expect(keys).not.toContain('bao');
    expect(keys).not.toContain('nhieu');
  });

  it('keeps dotted app names and their flat variant', () => {
    const keys = keysFor('Ai cạnh tranh với Judge.me?');
    expect(keys).toEqual(expect.arrayContaining(['judge.me', 'judgeme']));
  });

  it('matches multi-word names written by the distiller', () => {
    const memory = normalizeKeys(['Product Reviews', 'Judge.me']);
    const question = keysFor('Is Product Reviews the Shopify one?');
    expect(memory.filter((k) => question.includes(k))).toContain('product reviews');
  });
});
