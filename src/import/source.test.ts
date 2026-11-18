import { describe, expect, it } from 'vite-plus/test';
import { crc32 } from '../export/crc32';
import { ZipWriter } from '../export/zip';
import { folderSource, rootOf, SourceError, zipSource, type ImportSource } from './source';

const bytes = (s: string) => new TextEncoder().encode(s);
const DATE = new Date(2026, 10, 16);

/** A file as `<input webkitdirectory>` gives it: its path from the folder picked. */
function picked(path: string, text: string): File {
  const f = new File([text], path.split('/').pop() as string);
  Object.defineProperty(f, 'webkitRelativePath', { value: path });
  return f;
}

function zipOf(name: string, files: [string, string][]): File {
  const zip = new ZipWriter();
  for (const [path, text] of files) zip.add(path, bytes(text), crc32(bytes(text)), DATE);
  return new File([zip.finish()], name, { type: 'application/zip' });
}

const texts = async (s: ImportSource) =>
  Object.fromEntries(await Promise.all([...s.files].map(async ([path, f]) => [path, await (await f.read()).text()] as const)));

describe('rootOf', () => {
  it('is the folder of the living.json nearest the top', () => {
    expect(rootOf(['living-ada/living.json', 'living-ada/media/2026/a.jpg'])).toBe('living-ada');
    expect(rootOf(['living.json', 'media/2026/a.jpg'])).toBe('');
    // a living.json deeper down (a copy of another export inside this one) does not count
    expect(rootOf(['备份/living-ada/living.json', '备份/living-ada/old/living-bob/living.json'])).toBe('备份/living-ada');
  });

  it('wants exactly one export', () => {
    expect(() => rootOf(['living-ada/media/a.jpg', 'living-ada/notliving.json'])).toThrow(SourceError);
    expect(() => rootOf([])).toThrow('没有找到 living.json');
    expect(() => rootOf(['living-ada/living.json', 'living-bob/living.json'])).toThrow('选中的不止一份导出，请只选其中一份');
  });
});

describe('folderSource', () => {
  it('takes the files under the export, by their path there, whichever folder was picked', async () => {
    const s = folderSource([
      picked('下载/living-ada/living.json', '{}'),
      picked('下载/living-ada/media/2026/2026-11-16_ph_1.jpg', 'jpg'),
      picked('下载/living-ada/entries/2026/2026-11-16 西湖.md', '# 西湖'),
      picked('下载/别的文件.txt', 'other'),
      picked('下载/living-adam/media/x.jpg', 'not this export')
    ]);
    expect(s.root).toBe('living-ada');
    expect(await texts(s)).toEqual({
      'living.json': '{}',
      'media/2026/2026-11-16_ph_1.jpg': 'jpg',
      'entries/2026/2026-11-16 西湖.md': '# 西湖'
    });
    expect(s.files.get('media/2026/2026-11-16_ph_1.jpg')?.size).toBe(3);
  });

  it('takes the export folder itself, and files picked one by one by their names', async () => {
    expect([...folderSource([picked('living-ada/living.json', '{}'), picked('living-ada/media/a.jpg', 'a')]).files.keys()]).toEqual([
      'living.json',
      'media/a.jpg'
    ]);
    const loose = folderSource([new File(['{}'], 'living.json'), new File(['a'], 'a.jpg')]);
    expect(loose.root).toBe('');
    expect([...loose.files.keys()]).toEqual(['living.json', 'a.jpg']);
  });

  it('says so when no export was picked', () => {
    expect(() => folderSource([picked('照片/a.jpg', 'a')])).toThrow(SourceError);
  });
});

describe('zipSource', () => {
  it('puts the parts of one export together', async () => {
    const s = await zipSource([
      zipOf('living-ada-2026-11-17-1.zip', [
        ['living-ada/README.md', '# Living'],
        ['living-ada/living.json', '{"format":"living-export"}'],
        ['living-ada/media/2026/2026-11-16_ph_1.jpg', 'one']
      ]),
      zipOf('living-ada-2026-11-17-2.zip', [['living-ada/media/2026/2026-11-17_ph_2.jpg', 'two']])
    ]);
    expect(s.root).toBe('living-ada');
    expect(await texts(s)).toEqual({
      'README.md': '# Living',
      'living.json': '{"format":"living-export"}',
      'media/2026/2026-11-16_ph_1.jpg': 'one',
      'media/2026/2026-11-17_ph_2.jpg': 'two'
    });
  });

  it('reads the folder zipped again, its files at the top', async () => {
    const s = await zipSource([
      zipOf('backup.zip', [
        ['living.json', '{}'],
        ['media/a.jpg', 'a']
      ])
    ]);
    expect(s.root).toBe('');
    expect([...s.files.keys()]).toEqual(['living.json', 'media/a.jpg']);
  });

  it('names the part it cannot read', async () => {
    const good = zipOf('living-ada-2026-11-17-1.zip', [['living-ada/living.json', '{}']]);
    const bad = new File(['not a zip at all'], 'living-ada-2026-11-17-2.zip');
    const err = await zipSource([good, bad]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SourceError);
    expect((err as Error).message).toBe('living-ada-2026-11-17-2.zip：不是 zip 文件，或者文件不完整');
    await expect(zipSource([zipOf('photos.zip', [['a.jpg', 'a']])])).rejects.toThrow('没有找到 living.json');
  });
});
