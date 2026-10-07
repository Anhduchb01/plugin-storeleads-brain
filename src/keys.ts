// Lexical lookup keys. Memories carry `keys`; a question is turned into the same kind of keys and
// recall matches on overlap. App names ("Judge.me", "Product Reviews") and Vietnamese text both
// need to land on the same normalised form, so: lowercase, strip diacritics, keep . and - inside words.

const STOPWORDS = new Set([
  // English
  'the', 'and', 'for', 'with', 'how', 'many', 'what', 'which', 'who', 'are', 'is', 'of', 'in', 'on', 'to', 'a', 'an',
  'app', 'apps', 'store', 'stores', 'does', 'do', 'it', 'its', 'by', 'vs', 'or', 'from', 'that', 'this', 'there',
  // Vietnamese (after diacritics are stripped)
  'co', 'bao', 'nhieu', 'la', 'cua', 'va', 'cho', 'trong', 'khong', 'nao', 'gi', 'thi', 'the', 'nhu', 'mot', 'cac',
  'nhung', 'duoc', 'dang', 'da', 'se', 'voi', 've', 'tu', 'den', 'bi', 'hay', 'hoac', 'neu', 'sao', 'ai', 'o', 'khi',
]);

export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

/** Words of a text, normalised; dots and dashes survive inside a word ("judge.me", "pre-order"). */
export function words(text: string): string[] {
  return normalize(text)
    .split(/[^a-z0-9.\-]+/)
    .map((w) => w.replace(/^[.\-]+|[.\-]+$/g, ''))
    .filter(Boolean);
}

/**
 * Keys for a question: single non-stopwords (plus their punctuation-free variant) and adjacent
 * pairs, so "Product Reviews" matches a memory keyed "product reviews".
 */
export function keysFor(text: string): string[] {
  const ws = words(text);
  const keys = new Set<string>();
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    if (w.length >= 2 && !STOPWORDS.has(w) && !/^\d+$/.test(w)) {
      keys.add(w);
      const flat = w.replace(/[.\-]/g, '');
      if (flat !== w && flat.length >= 2) keys.add(flat);
    }
    if (i + 1 < ws.length && !(STOPWORDS.has(w) && STOPWORDS.has(ws[i + 1]))) keys.add(`${w} ${ws[i + 1]}`);
  }
  return [...keys].slice(0, 200);
}

/** Normalise keys written by the distiller so they compare equal to keysFor() output. */
export function normalizeKeys(keys: string[]): string[] {
  const out = new Set<string>();
  for (const k of keys) {
    const n = words(k).join(' ');
    if (n.length >= 2) {
      out.add(n);
      const flat = n.replace(/[.\-]/g, '');
      if (flat !== n && flat.length >= 2) out.add(flat);
    }
  }
  return [...out];
}
