import { describe, expect, it } from 'vite-plus/test';
import { ENTRY_TYPE_LABELS, entryLabel, entryTypeLabel, excerptOf, hasTime, occurredDay } from './entries';
import { ENTRY_TYPES } from './types';

describe('entry types', () => {
  it('names every type', () => {
    for (const t of ENTRY_TYPES) expect(ENTRY_TYPE_LABELS[t], t).toBeTruthy();
    expect(new Set(Object.values(ENTRY_TYPE_LABELS)).size).toBe(ENTRY_TYPES.length);
  });

  it('reads a type it does not know as a note', () => {
    expect(entryTypeLabel('reading')).toBe('阅读');
    expect(entryTypeLabel('podcast')).toBe('随记');
  });
});

describe('occurredAt', () => {
  it('has a day, and sometimes a time', () => {
    expect(occurredDay('2026-11-16')).toBe('2026-11-16');
    expect(occurredDay('2026-11-16T08:30:00')).toBe('2026-11-16');
    expect(hasTime('2026-11-16')).toBe(false);
    expect(hasTime('2026-11-16T08:30:00')).toBe(true);
  });
});

describe('excerptOf', () => {
  it('keeps a short body whole', () => {
    expect(excerptOf('今天练了一页字。', 300)).toEqual({ excerpt: '今天练了一页字。', hasMore: false });
    expect(excerptOf('x'.repeat(300), 300)).toEqual({ excerpt: 'x'.repeat(300), hasMore: false });
  });

  it('has nothing to show for no body', () => {
    expect(excerptOf(null, 300)).toEqual({ excerpt: null, hasMore: false });
    expect(excerptOf('', 300)).toEqual({ excerpt: null, hasMore: false });
  });

  it('tells from one code point past the limit that the body goes on', () => {
    expect(excerptOf('x'.repeat(301), 300)).toEqual({ excerpt: 'x'.repeat(300), hasMore: true });
  });

  it('cuts at the last line break of the second half', () => {
    const body = `${'甲'.repeat(200)}\n${'乙'.repeat(150)}`;
    expect(excerptOf(body, 300)).toEqual({ excerpt: '甲'.repeat(200), hasMore: true });
    // a line break in the first half would leave too little: cut mid-line instead
    const early = `${'甲'.repeat(20)}\n${'乙'.repeat(400)}`;
    expect(excerptOf(early, 300).excerpt).toBe(`${'甲'.repeat(20)}\n${'乙'.repeat(279)}`);
  });

  it('counts code points, so emoji and CJK are one each and never split', () => {
    const body = '😀'.repeat(301);
    const { excerpt, hasMore } = excerptOf(body, 300);
    expect([...(excerpt ?? '')]).toHaveLength(300);
    expect(excerpt).toBe('😀'.repeat(300));
    expect(hasMore).toBe(true);
  });

  it('drops whitespace left at the cut', () => {
    const body = `${'甲'.repeat(200)}   \n\n${'乙'.repeat(150)}`;
    expect(excerptOf(body, 300).excerpt).toBe('甲'.repeat(200));
  });
});

describe('entryLabel', () => {
  it('prefers the title, on one line', () => {
    expect(entryLabel('  兰亭序 \n 第三遍 ', '正文')).toBe('兰亭序 第三遍');
  });

  it('falls back to the first line of the body that has words, without its Markdown', () => {
    expect(entryLabel(null, '\n\n# 第一课：*永*字八法\n\n正文')).toBe('第一课：永字八法');
    expect(entryLabel('', '> 引一句 **话**')).toBe('引一句 话');
    expect(entryLabel(null, '- [x] 读完第三章\n- [ ] 第四章')).toBe('读完第三章');
    expect(entryLabel(null, '1. 早起\n2. 跑步')).toBe('早起');
    expect(entryLabel(null, '---\n\n今天')).toBe('今天');
  });

  it('turns links into their text and resolves escapes', () => {
    expect(entryLabel(null, '读了 [《长安的荔枝》](https://example.com/book) 一章')).toBe('读了 《长安的荔枝》 一章');
    expect(entryLabel(null, '看 <https://example.com>')).toBe('看 https://example.com');
    expect(entryLabel(null, '1\\*2 = 2 和 `code` ~~删~~')).toBe('1*2 = 2 和 code 删');
  });

  it('keeps underscores inside words and drops emphasis underscores', () => {
    expect(entryLabel(null, 'snake_case_name 是 _斜体_')).toBe('snake_case_name 是 斜体');
  });

  it('skips code blocks', () => {
    expect(entryLabel(null, '```\nconst a = 1;\n```\n运行通过')).toBe('运行通过');
  });

  it('clips to the limit with an ellipsis', () => {
    expect(entryLabel(null, '一二三四五六七八九十', 4)).toBe('一二三四…');
    expect(entryLabel('一二三四', null, 4)).toBe('一二三四');
  });

  it('is empty when there are no words', () => {
    expect(entryLabel(null, null)).toBe('');
    expect(entryLabel('  ', '\n\n***\n')).toBe('');
  });
});
