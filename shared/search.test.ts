import { describe, expect, it } from 'vite-plus/test';
import { asciiLower, highlightRanges, queryProblem, searchTerms, snippetAround, SNIPPET_MAX } from './search';

describe('searchTerms', () => {
  it('splits at any space, the ideographic one too, and keeps the order', () => {
    expect(searchTerms('西湖  断桥　孤山')).toEqual(['西湖', '断桥', '孤山']);
    expect(searchTerms('  ')).toEqual([]);
  });

  it('reads a quoted phrase as one word, in straight or curly quotes or in 「」', () => {
    expect(searchTerms('"west lake" 断桥')).toEqual(['west lake', '断桥']);
    expect(searchTerms('“西湖 夜景” 「断桥 残雪」')).toEqual(['西湖 夜景', '断桥 残雪']);
    // inner runs of spaces become one, as they would match nothing otherwise
    expect(searchTerms('"a   b"')).toEqual(['a b']);
  });

  it('keeps an unclosed quote as part of the word', () => {
    expect(searchTerms('"west lake')).toEqual(['"west', 'lake']);
  });

  it('drops a word given twice, A–Z case aside', () => {
    expect(searchTerms('Lake lake LAKE 湖 湖')).toEqual(['Lake', '湖']);
  });
});

describe('asciiLower', () => {
  it('lower-cases A–Z only, as SQLite does', () => {
    expect(asciiLower('West LAKE Ä')).toBe('west lake Ä');
  });
});

describe('queryProblem', () => {
  it('asks for words, at most 100 characters and 5 words', () => {
    expect(queryProblem('西湖')).toBeNull();
    expect(queryProblem('   ')).toBe('输入要找的字');
    expect(queryProblem('a b c d e')).toBeNull();
    expect(queryProblem('a b c d e f')).toBe('最多 5 个词');
    expect(queryProblem('字'.repeat(100))).toBeNull();
    expect(queryProblem('字'.repeat(101))).toBe('最多 100 个字');
    // characters, not UTF-16 units
    expect(queryProblem('😀'.repeat(100))).toBeNull();
  });
});

describe('snippetAround', () => {
  it('shows a short text whole, as plain text', () => {
    expect(snippetAround('# 记\n\n去了**西湖**，[断桥](https://example.com)上', ['西湖'])).toBe('记 去了西湖，断桥上');
  });

  it('centres a long text on the first word found, with ellipses where it is cut', () => {
    const text = `${'前'.repeat(200)}西湖${'后'.repeat(200)}`;
    const s = snippetAround(text, ['西湖']);
    expect(s.startsWith('…')).toBe(true);
    expect(s.endsWith('…')).toBe(true);
    expect(s).toContain('西湖');
    // the word comes early, after a little of what leads up to it
    expect(s.indexOf('西湖')).toBeLessThan(40);
    expect([...s.replace(/…/g, '')].length).toBe(SNIPPET_MAX);
  });

  it('starts at the earliest of the words, whichever comes first in the query', () => {
    const text = `${'a'.repeat(100)}孤山${'b'.repeat(300)}断桥${'c'.repeat(100)}`;
    expect(snippetAround(text, ['断桥', '孤山'])).toContain('孤山');
  });

  it('counts characters, so text before the word may hold emoji', () => {
    const text = `${'😀'.repeat(60)}西湖${'后'.repeat(10)}`;
    const s = snippetAround(text, ['西湖']);
    expect(s).toContain('西湖');
    expect(s.endsWith('后')).toBe(true);
  });

  it('moves back from the end so that a word near it still has text before it', () => {
    const text = `${'前'.repeat(300)}西湖`;
    const s = snippetAround(text, ['西湖']);
    expect(s.endsWith('西湖')).toBe(true);
    expect([...s.replace(/…/g, '')].length).toBe(SNIPPET_MAX);
  });

  it('starts from the beginning when no word is in it, and marks a window cut from a longer text', () => {
    expect(snippetAround('今天很好', ['西湖'])).toBe('今天很好');
    expect(snippetAround('今天很好', ['西湖'], true, true)).toBe('…今天很好…');
  });

  it('finds words A–Z case aside', () => {
    expect(snippetAround('Sunset at West Lake', ['west'])).toBe('Sunset at West Lake');
  });
});

describe('highlightRanges', () => {
  it('finds every occurrence of every word, A–Z case aside', () => {
    expect(highlightRanges('West lake, west LAKE', ['west', 'lake'])).toEqual([
      [0, 4],
      [5, 9],
      [11, 15],
      [16, 20]
    ]);
  });

  it('merges overlapping and touching words', () => {
    expect(highlightRanges('西湖断桥', ['西湖', '湖断', '断桥'])).toEqual([[0, 4]]);
  });

  it('gives UTF-16 indices that slice the text', () => {
    const text = '😀西湖';
    const [[start, end]] = highlightRanges(text, ['西湖']);
    expect(text.slice(start, end)).toBe('西湖');
  });

  it('finds nothing for no words or an empty one', () => {
    expect(highlightRanges('西湖', [])).toEqual([]);
    expect(highlightRanges('西湖', [''])).toEqual([]);
  });
});
