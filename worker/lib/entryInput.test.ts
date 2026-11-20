import { describe, expect, it } from 'vite-plus/test';
import { ENTRY_LIMITS } from '../../shared/limits';
import { invalidMessage } from '../test-utils';
import { assertNotEmpty, optBody, parseEntryFields, parseMedia } from './entryInput';
import { optOccurredAt } from './validate';

describe('optOccurredAt', () => {
  it('takes a day on its own', () => {
    expect(optOccurredAt('2026-11-16')).toBe('2026-11-16');
    expect(optOccurredAt(' 2024-02-29 ')).toBe('2024-02-29');
  });

  it('takes a local date-time like a capture time: seconds filled in, a zone dropped', () => {
    expect(optOccurredAt('2026-11-16T08:30')).toBe('2026-11-16T08:30:00');
    expect(optOccurredAt('2026-11-16T08:30:15.120+08:00')).toBe('2026-11-16T08:30:15');
  });

  it('treats null, undefined and an empty string as absent', () => {
    expect(optOccurredAt(null)).toBeNull();
    expect(optOccurredAt(undefined)).toBeNull();
    expect(optOccurredAt('')).toBeNull();
  });

  it('refuses what is not a real day or time', () => {
    for (const v of ['2023-02-29', '2026-13-01', '2026-11-16T24:00', '16/11/2026', '2026-11', 20261116, {}, '2026-11-16 08:30']) {
      expect(invalidMessage(() => optOccurredAt(v))).toBe('发生时间格式应为 YYYY-MM-DD 或 YYYY-MM-DDTHH:mm:ss');
    }
  });
});

describe('optBody', () => {
  it('keeps Markdown as written, without blank lines before it or whitespace after it', () => {
    expect(optBody('\n\n# 标题\n\n- 一\n- 二  \n\n')).toBe('# 标题\n\n- 一\n- 二');
  });

  it('keeps the first line’s own indentation', () => {
    expect(optBody('\n　　今天天气很好。\n')).toBe('　　今天天气很好。');
    expect(optBody('  缩进')).toBe('  缩进');
  });

  it('normalises line endings', () => {
    expect(optBody('一\r\n二\r三')).toBe('一\n二\n三');
  });

  it('reads blank as no body', () => {
    expect(optBody(null)).toBeNull();
    expect(optBody(undefined)).toBeNull();
    expect(optBody(' \n　\n\t')).toBeNull();
  });

  it('counts the limit in code points', () => {
    expect(optBody('字'.repeat(ENTRY_LIMITS.bodyMax))).toHaveLength(ENTRY_LIMITS.bodyMax);
    expect(invalidMessage(() => optBody('字'.repeat(ENTRY_LIMITS.bodyMax + 1)))).toBe(`正文最多 ${ENTRY_LIMITS.bodyMax} 个字符`);
    expect(invalidMessage(() => optBody(42))).toBe('正文需要是文字');
  });
});

describe('parseMedia', () => {
  it('keeps the order and the captions, and counts a photo listed twice once', () => {
    expect(parseMedia([{ photoId: 'ph_b', caption: ' 第三遍 ' }, { photoId: 'ph_a' }, { photoId: 'ph_b', caption: '又一次' }])).toEqual([
      { photoId: 'ph_b', caption: '第三遍' },
      { photoId: 'ph_a', caption: null }
    ]);
  });

  it('refuses what is not a list of photos', () => {
    expect(invalidMessage(() => parseMedia('ph_a'))).toBe('照片需要是数组');
    expect(invalidMessage(() => parseMedia(null))).toBe('照片需要是数组');
    expect(invalidMessage(() => parseMedia([{ photoId: 'ph_a' }, 'ph_b']))).toBe('第 2 张照片格式不对');
    expect(invalidMessage(() => parseMedia([{ photoId: '../etc' }]))).toBe('第 1 张照片格式不对');
    expect(invalidMessage(() => parseMedia([{ photoId: 'ph_a', caption: 3 }]))).toBe('第 1 张照片的说明需要是文字');
  });

  it('has a limit on photos and captions', () => {
    const many = Array.from({ length: ENTRY_LIMITS.mediaCount + 1 }, (_, i) => ({ photoId: `ph_${i}` }));
    expect(invalidMessage(() => parseMedia(many))).toBe(`一条记录最多 ${ENTRY_LIMITS.mediaCount} 张照片`);
    expect(invalidMessage(() => parseMedia([{ photoId: 'ph_a', caption: '字'.repeat(ENTRY_LIMITS.captionMax + 1) }]))).toBe(
      `第 1 张照片的说明最多 ${ENTRY_LIMITS.captionMax} 个字符`
    );
  });
});

describe('parseEntryFields', () => {
  it('needs only a time to create', () => {
    expect(parseEntryFields({ occurredAt: '2026-11-16T08:30' }, true)).toEqual({ occurredAt: '2026-11-16T08:30:00' });
    expect(invalidMessage(() => parseEntryFields({ body: '一句话' }, true))).toBe(
      '请填写发生时间，格式为 YYYY-MM-DD 或 YYYY-MM-DDTHH:mm:ss'
    );
  });

  it('reads every field', () => {
    expect(
      parseEntryFields(
        {
          type: 'practice',
          title: ' 永字八法 ',
          body: '第一天',
          occurredAt: '2026-11-16',
          visibility: 'unlisted',
          status: 'draft',
          media: [{ photoId: 'ph_a', caption: '临帖' }],
          tagIds: ['t_1', 't_1', 'season']
        },
        true
      )
    ).toEqual({
      type: 'practice',
      title: '永字八法',
      body: '第一天',
      occurredAt: '2026-11-16',
      visibility: 'unlisted',
      status: 'draft',
      media: [{ photoId: 'ph_a', caption: '临帖' }],
      tagIds: ['t_1', 'season']
    });
  });

  it('changes only what a PATCH names, and null clears the title and body', () => {
    expect(parseEntryFields({}, false)).toEqual({});
    expect(parseEntryFields({ title: null, body: null }, false)).toEqual({ title: null, body: null });
    expect(parseEntryFields({ media: [], tagIds: [] }, false)).toEqual({ media: [], tagIds: [] });
  });

  it('cannot clear the time on a PATCH', () => {
    expect(invalidMessage(() => parseEntryFields({ occurredAt: null }, false))).toBe(
      '请填写发生时间，格式为 YYYY-MM-DD 或 YYYY-MM-DDTHH:mm:ss'
    );
  });

  it('reads the revision of a PATCH only', () => {
    expect(parseEntryFields({ revision: 4 }, false)).toEqual({ revision: 4 });
    expect(parseEntryFields({ revision: 4, occurredAt: '2026-11-16' }, true)).toEqual({ occurredAt: '2026-11-16' });
    expect(invalidMessage(() => parseEntryFields({ revision: 1.5 }, false))).toBe('revision需要是整数');
    expect(invalidMessage(() => parseEntryFields({ revision: 0 }, false))).toBe('revision不能小于 1');
  });

  it('refuses unknown types, visibilities and statuses', () => {
    expect(invalidMessage(() => parseEntryFields({ type: 'diary', occurredAt: '2026-11-16' }, true))).toContain('记录类型需要是');
    expect(invalidMessage(() => parseEntryFields({ visibility: 'friends' }, false))).toContain('公开范围需要是');
    expect(invalidMessage(() => parseEntryFields({ status: 'deleted' }, false))).toContain('状态需要是');
    expect(invalidMessage(() => parseEntryFields({ tagIds: 'season' }, false))).toBe('标签需要是数组');
  });

  it('checks the length of the title', () => {
    expect(invalidMessage(() => parseEntryFields({ title: '字'.repeat(ENTRY_LIMITS.titleMax + 1) }, false))).toBe(
      `标题最多 ${ENTRY_LIMITS.titleMax} 个字符`
    );
  });
});

describe('assertNotEmpty', () => {
  it('lets through an entry with a title, a text or a photo', () => {
    expect(() => assertNotEmpty('题', null, 0)).not.toThrow();
    expect(() => assertNotEmpty(null, '字', 0)).not.toThrow();
    expect(() => assertNotEmpty(null, null, 1)).not.toThrow();
  });

  it('refuses an entry with nothing in it', () => {
    expect(invalidMessage(() => assertNotEmpty(null, null, 0))).toBe('记录不能是空的：写点文字，或者加一张照片、一个附件');
    expect(invalidMessage(() => assertNotEmpty(undefined, '', 0))).toBe('记录不能是空的：写点文字，或者加一张照片、一个附件');
  });
});
