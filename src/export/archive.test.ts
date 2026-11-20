import { describe, expect, it } from 'vite-plus/test';
import { exportData, exportEntry, exportPhoto, exportPlace, exportProject, exportTheme, EXPORT_PROFILE } from '../test-utils';
import {
  FORMAT,
  FORMAT_VERSION,
  frontmatter,
  localDate,
  mediaPath,
  PathSet,
  relative,
  rootFolder,
  safeName,
  textFiles,
  zipName,
  type PhotoFile,
  type TextFile
} from './archive';

const SITE = { name: 'Living', url: 'https://living.example' };
const NOW = new Date(2026, 10, 17, 9, 5);

const byPath = (files: TextFile[]) => new Map(files.map((f) => [f.path, f.text]));
const json = (files: TextFile[]) => JSON.parse(byPath(files).get('living.json') as string);

describe('names', () => {
  it('makes a file name of any title: no characters a file system or a Markdown link trips on', () => {
    expect(safeName('a/b\\c:d*e?f"g<h>i|j#k[l]m')).toBe('a b c d e f g h i j k l m');
    expect(safeName('  西湖\t边的\n一个下午  ')).toBe('西湖 边的 一个下午');
    expect(safeName('line break')).toBe('line break');
    // no dot or space at the end (Windows drops them), and no device names
    expect(safeName('看完了...')).toBe('看完了');
    expect(safeName('CON')).toBe('CON_');
    expect(safeName('com1')).toBe('com1_');
    expect(safeName('console')).toBe('console');
  });

  it('cuts by characters, not by UTF-16 units', () => {
    expect(safeName('😀'.repeat(50), 40)).toBe('😀'.repeat(40));
    expect(safeName('一'.repeat(41))).toHaveLength(40);
  });

  it('numbers a path already taken, whatever its case', () => {
    const paths = new PathSet();
    expect(paths.take('entries/2026', '2026-11-16 随记', '.md')).toBe('entries/2026/2026-11-16 随记.md');
    expect(paths.take('entries/2026', '2026-11-16 随记', '.md')).toBe('entries/2026/2026-11-16 随记 (2).md');
    expect(paths.take('projects', 'Guitar', '.md')).toBe('projects/Guitar.md');
    expect(paths.take('projects', 'guitar', '.md')).toBe('projects/guitar (2).md');
    expect(paths.take('collections', 'guitar', '.md')).toBe('collections/guitar.md');
  });

  it('names the folder and the ZIP by the account and the day', () => {
    expect(rootFolder({ handle: 'ada' })).toBe('living-ada');
    expect(zipName('living-ada', '2026-11-17', null)).toBe('living-ada-2026-11-17.zip');
    expect(zipName('living-ada', '2026-11-17', 2)).toBe('living-ada-2026-11-17-2.zip');
  });
});

describe('localDate', () => {
  it('reads a wall-clock time as local, and a stamp ending in Z as UTC', () => {
    expect(localDate('2026-11-16T15:30:05')).toEqual(new Date(2026, 10, 16, 15, 30, 5));
    expect(localDate('2026-11-16')).toEqual(new Date(2026, 10, 16));
    expect(localDate('2026-11-16T08:00:00Z')?.getTime()).toBe(Date.UTC(2026, 10, 16, 8));
    expect(localDate(null)).toBeNull();
    expect(localDate('someday')).toBeNull();
  });
});

describe('mediaPath', () => {
  it('files a photo under the year it was taken, by its day and id, with its own extension', () => {
    expect(mediaPath({ id: 'ph_1', takenAt: '2026-11-16T15:30:00' }, 'o/u/ph_1.HEIC')).toBe('media/2026/2026-11-16_ph_1.heic');
    expect(mediaPath({ id: 'ph_1', takenAt: null }, 'o/u/ph_1.jpg')).toBe('media/undated/ph_1.jpg');
    expect(mediaPath({ id: 'ph_1', takenAt: null }, 'o/u/ph_1')).toBe('media/undated/ph_1.bin');
  });
});

describe('relative', () => {
  it('links between files under the root', () => {
    expect(relative('entries/2026/a.md', 'media/2026/b.jpg')).toBe('../../media/2026/b.jpg');
    expect(relative('entries/2026/a.md', 'entries/2026/b.md')).toBe('b.md');
    expect(relative('collections/a.md', 'entries/2026/b.md')).toBe('../entries/2026/b.md');
    expect(relative('README.md', 'media/x.jpg')).toBe('media/x.jpg');
  });
});

describe('frontmatter', () => {
  it('writes JSON values, which YAML reads as they are, and leaves out the empty ones', () => {
    expect(
      frontmatter([
        ['title', '冒号: 和 "引号"'],
        ['n', 2],
        ['none', null],
        ['blank', ''],
        ['tags', []],
        ['list', ['a', 'b']]
      ])
    ).toBe('---\ntitle: "冒号: 和 \\"引号\\""\nn: 2\nlist: ["a","b"]\n---');
  });
});

describe('textFiles', () => {
  const data = exportData({
    photos: [exportPhoto('ph_1'), exportPhoto('ph_2', { takenAt: '2025-05-01T09:00:00' }), exportPhoto('ph_3', { takenAt: null })],
    photoTags: [{ photoId: 'ph_1', tagId: 't_1', source: 'manual' }],
    entries: [
      exportEntry('en_2', { title: '西湖边的一个下午', body: '走了一圈。', poiId: 'poi_1', occurredAt: '2026-11-16T16:00:00' }),
      exportEntry('en_1', { body: '**今天**去了西湖', status: 'draft' }),
      exportEntry('en_3', { body: '今天去了西湖', occurredAt: '2026-11-16T20:00:00' }),
      exportEntry('en_4', { type: 'reading', body: null, occurredAt: '2025-01-02T08:00:00' })
    ],
    entryMedia: [
      { entryId: 'en_2', photoId: 'ph_2', position: 1, caption: '湖边\n第二行' },
      { entryId: 'en_2', photoId: 'ph_1', position: 0, caption: null }
    ],
    entryTags: [{ entryId: 'en_2', tagId: 't_1' }],
    entryProjects: [{ entryId: 'en_2', projectId: 'pj_1' }],
    projects: [exportProject('pj_1', { description: '每天练半小时。' })],
    milestones: [
      {
        id: 'ms_2',
        projectId: 'pj_1',
        title: '第一首曲子',
        body: '《小星星》',
        date: '2026-10-01',
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T00:00:00Z'
      },
      {
        id: 'ms_1',
        projectId: 'pj_1',
        title: '买琴',
        body: null,
        date: '2026-09-01',
        createdAt: '2026-09-01T00:00:00Z',
        updatedAt: '2026-09-01T00:00:00Z'
      }
    ],
    themes: [exportTheme('th_1', { intro: '三天两夜。' })],
    themeItems: [
      { id: 'it_3', themeId: 'th_1', position: 2, kind: 'photo', photoId: 'ph_3', entryId: null, text: '傍晚', day: null },
      { id: 'it_1', themeId: 'th_1', position: 0, kind: 'day', photoId: null, entryId: null, text: '到杭州', day: '2026-11-15' },
      { id: 'it_2', themeId: 'th_1', position: 1, kind: 'entry', photoId: null, entryId: 'en_2', text: null, day: null },
      { id: 'it_4', themeId: 'th_1', position: 3, kind: 'text', photoId: null, entryId: null, text: '回家。', day: null }
    ],
    tags: [{ id: 't_1', ownerId: null, parentId: null, name: '风景', color: null, sort: 0, createdAt: '2026-01-01T00:00:00Z' }],
    places: [exportPlace('poi_1')]
  });
  const files = new Map<string, PhotoFile>([
    ['ph_1', { path: 'media/2026/2026-11-16_ph_1.jpg' }],
    ['ph_2', { path: 'media/2025/2025-05-01_ph_2.webp', large: true }]
  ]);
  const out = textFiles(data, files, SITE, NOW);
  const text = byPath(out);

  it('writes one Markdown file an entry, by the year and day it happened and its title or first line', () => {
    expect(out.map((f) => f.path)).toEqual([
      'README.md',
      'entries/2025/2025-01-02 阅读.md',
      'entries/2026/2026-11-16 今天去了西湖.md',
      'entries/2026/2026-11-16 西湖边的一个下午.md',
      'entries/2026/2026-11-16 今天去了西湖 (2).md',
      'projects/学吉他.md',
      'collections/杭州.md',
      'living.json'
    ]);
    // a file's time is when it happened
    expect(out[3].mtime).toEqual(new Date(2026, 10, 16, 16));
  });

  it('gives an entry its frontmatter, its text and its photos, linked where they are', () => {
    expect(text.get('entries/2026/2026-11-16 西湖边的一个下午.md')).toBe(
      [
        '---',
        'id: "en_2"',
        'type: "note"',
        'title: "西湖边的一个下午"',
        'occurred: "2026-11-16T16:00:00"',
        'created: "2026-11-16T08:00:00Z"',
        'updated: "2026-11-16T08:00:00Z"',
        'status: "published"',
        'visibility: "private"',
        'place: "西湖，西湖区"',
        'tags: ["风景"]',
        'projects: ["学吉他"]',
        'collections: ["杭州"]',
        '---',
        '',
        '# 西湖边的一个下午',
        '',
        '走了一圈。',
        '',
        '![](<../../media/2026/2026-11-16_ph_1.jpg>)',
        '',
        '![湖边](<../../media/2025/2025-05-01_ph_2.webp>)',
        '',
        '湖边\n第二行',
        ''
      ].join('\n')
    );
    expect(text.get('entries/2026/2026-11-16 今天去了西湖.md')).toContain('status: "draft"');
  });

  it('escapes brackets and backslashes in a label, so the link stays a link', () => {
    const t = byPath(
      textFiles(
        exportData({
          photos: [exportPhoto('ph_1')],
          entries: [exportEntry('en_1', { title: '[草稿] a\\b', occurredAt: '2026-11-16T16:00:00' })],
          entryMedia: [{ entryId: 'en_1', photoId: 'ph_1', position: 0, caption: '[左] 和 [右]' }],
          entryProjects: [{ entryId: 'en_1', projectId: 'pj_1' }],
          projects: [exportProject('pj_1')]
        }),
        new Map([['ph_1', { path: 'media/2026/2026-11-16_ph_1.jpg' }]]),
        SITE,
        NOW
      )
    );
    expect(t.get('entries/2026/2026-11-16 草稿 a b.md')).toContain('![\\[左\\] 和 \\[右\\]](<../../media/2026/2026-11-16_ph_1.jpg>)');
    expect(t.get('projects/学吉他.md')).toContain('[\\[草稿\\] a\\\\b](<../entries/2026/2026-11-16 草稿 a b.md>)');
  });

  it('lists a project with its milestones by date and its entries', () => {
    const md = text.get('projects/学吉他.md') as string;
    expect(md).toContain('# 学吉他\n\n学习 · 进行中 · 2026-09-01 起\n\n每天练半小时。');
    expect(md.indexOf('### 2026-09-01 买琴')).toBeLessThan(md.indexOf('### 2026-10-01 第一首曲子\n\n《小星星》'));
    expect(md).toContain('## 记录\n\n- 2026-11-16 [西湖边的一个下午](<../entries/2026/2026-11-16 西湖边的一个下午.md>)');
  });

  it('keeps a collection in its order: days, entries, photos and text', () => {
    const md = text.get('collections/杭州.md') as string;
    expect(md.slice(md.indexOf('# 杭州'))).toBe(
      [
        '# 杭州',
        '三天两夜。',
        '## 2026-11-15 到杭州',
        '[→ 西湖边的一个下午](<../entries/2026/2026-11-16 西湖边的一个下午.md>)',
        // a photo without a file in the export is named by its id
        '（照片 ph_3）\n\n傍晚',
        '回家。\n'
      ].join('\n\n')
    );
  });

  it('puts everything in living.json, with where each item went and the list of files', () => {
    const j = json(out);
    expect(j.format).toBe(FORMAT);
    expect(j.version).toBe(FORMAT_VERSION);
    expect(j.exportedAt).toBe(NOW.toISOString());
    expect(j.site).toEqual(SITE);
    expect(j.profile).toEqual(EXPORT_PROFILE);
    const [p1, p2, p3] = j.photos;
    expect(p1).toMatchObject({ id: 'ph_1', tags: [{ id: 't_1', source: 'manual' }], file: 'media/2026/2026-11-16_ph_1.jpg' });
    expect(p1.fileIsLarge).toBeUndefined();
    expect(p2).toMatchObject({ file: 'media/2025/2025-05-01_ph_2.webp', fileIsLarge: true });
    expect(p3.file).toBeNull();
    const e2 = j.entries.find((e: { id: string }) => e.id === 'en_2');
    expect(e2).toMatchObject({
      media: [
        { photoId: 'ph_1', caption: null },
        { photoId: 'ph_2', caption: '湖边\n第二行' }
      ],
      tagIds: ['t_1'],
      projectIds: ['pj_1'],
      file: 'entries/2026/2026-11-16 西湖边的一个下午.md'
    });
    expect(j.projects[0].milestones.map((m: { id: string }) => m.id)).toEqual(['ms_1', 'ms_2']);
    expect(j.projects[0].milestones[0].projectId).toBeUndefined();
    expect(j.collections[0].items.map((i: { id: string }) => i.id)).toEqual(['it_1', 'it_2', 'it_3', 'it_4']);
    expect(j.files).toEqual(
      [
        ...out.filter((f) => f.path !== 'living.json').map((f) => f.path),
        'media/2026/2026-11-16_ph_1.jpg',
        'media/2025/2025-05-01_ph_2.webp'
      ].sort()
    );
  });

  it('says in the README what is in the export', () => {
    const readme = text.get('README.md') as string;
    expect(readme).toContain('@ada（Ada）的档案，导出于 2026-11-17 09:05，来自 https://living.example。');
    expect(readme).toContain('4 条记录（含 1 条草稿和已归档的）');
    expect(readme).toContain(
      '- `media/`：2 张照片，上传时的原文件，按拍摄的年份分文件夹，文件名是拍摄日期和照片的编号。其中 1 张缺少原文件，是 2560 像素的大图。另有 1 张找不到文件'
    );
  });

  it('says so when the photos were left out, or kept from an earlier export', () => {
    const none = byPath(textFiles(data, new Map(), SITE, NOW, false)).get('README.md') as string;
    expect(none).toContain('- 这次导出没有下载照片：3 张照片只有信息在 living.json 里');
    const kept = byPath(textFiles(data, new Map([['ph_1', { path: 'media/2026/2026-11-16_ph_1.jpg' }]]), SITE, NOW, false)).get(
      'README.md'
    ) as string;
    expect(kept).toContain('- `media/`：1 张照片的原文件，是之前导出到这个文件夹时下载的');
    expect(kept).toContain('其余 2 张只有信息在 living.json 里');
    expect(byPath(textFiles(exportData(), new Map(), SITE, NOW)).get('README.md')).not.toContain('media');
  });
});
