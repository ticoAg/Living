import { describe, expect, it } from 'vite-plus/test';
import { FakeDir } from '../test-utils';
import { FORMAT } from './archive';
import { FolderSink, isOurs, ZipSink } from './sinks';
import { ZipWriter } from './zip';

const blob = (s: string) => new Blob([s]);

/** The names a ZIP holds, from its central directory. */
async function names(zip: Blob): Promise<string[]> {
  const buf = new Uint8Array(await zip.arrayBuffer());
  const v = new DataView(buf.buffer);
  const end = buf.length - 22;
  let at = v.getUint32(end + 16, true);
  const out: string[] = [];
  for (let i = 0; i < v.getUint16(end + 10, true); i++) {
    const n = v.getUint16(at + 28, true);
    out.push(new TextDecoder().decode(buf.subarray(at + 46, at + 46 + n)));
    at += 46 + n;
  }
  return out;
}

describe('ZipSink', () => {
  it('puts every file under the root folder, in one archive when it fits', async () => {
    const parts: [Blob, number, boolean][] = [];
    const sink = new ZipSink('living-ada', (b, i, last) => parts.push([b, i, last]));
    await sink.write('media/2026/a.jpg', blob('aaaa'), new Date());
    await sink.write('README.md', blob('# hi'), new Date());
    expect(parts).toHaveLength(0);
    await sink.close();
    expect(parts.map(([, i, last]) => [i, last])).toEqual([[1, true]]);
    expect(await names(parts[0][0])).toEqual(['living-ada/media/2026/a.jpg', 'living-ada/README.md']);
  });

  it('starts a new part before a file that would not fit, and hands each over as soon as it is done', async () => {
    const parts: [Blob, number, boolean][] = [];
    // two files and the end record
    const room = ZipWriter.cost('r/a', 10) + ZipWriter.cost('r/b', 10) + 22;
    const sink = new ZipSink('r', (b, i, last) => parts.push([b, i, last]), room);
    await sink.write('a', blob('0123456789'), new Date());
    await sink.write('b', blob('0123456789'), new Date());
    await sink.write('c', blob('0123456789'), new Date());
    expect(parts.map(([, i, last]) => [i, last])).toEqual([[1, false]]);
    // a file larger than a part still goes in, alone
    await sink.write('d', blob('x'.repeat(room * 2)), new Date());
    await sink.close();
    expect(parts[0][0].size).toBe(room);
    expect(parts.map(([, i, last]) => [i, last])).toEqual([
      [1, false],
      [2, false],
      [3, true]
    ]);
    expect(await Promise.all(parts.map(([b]) => names(b)))).toEqual([['r/a', 'r/b'], ['r/c'], ['r/d']]);
  });

  it('makes no empty part before a first file larger than a part', async () => {
    const parts: Blob[] = [];
    const sink = new ZipSink('r', (b) => parts.push(b), 64);
    await sink.write('a', blob('x'.repeat(200)), new Date());
    await sink.write('b', blob('y'), new Date());
    await sink.close();
    expect(await Promise.all(parts.map(names))).toEqual([['r/a'], ['r/b']]);
  });

  it('knows of no earlier export', async () => {
    const sink = new ZipSink('r', () => {});
    expect(await sink.existing()).toBeNull();
    expect(await sink.previous()).toEqual({ ownerId: null, files: [] });
  });
});

describe('FolderSink', () => {
  it('writes files into folders it makes on the way, and tells the size of one already there', async () => {
    const dir = new FakeDir('living-ada');
    const sink = new FolderSink(dir.handle);
    await sink.write('media/2026/a.jpg', blob('aaaa'));
    await sink.write('media/2026/b.jpg', blob('bb'));
    await sink.write('README.md', blob('# hi'));
    expect([...dir.files().keys()]).toEqual(['media/2026/a.jpg', 'media/2026/b.jpg', 'README.md']);
    expect(await sink.existing('media/2026/a.jpg')).toBe(4);
    expect(await sink.existing('media/2025/a.jpg')).toBeNull();
    expect(await sink.existing('entries/x.md')).toBeNull();
    // a folder looked up before it existed is found once it does
    await sink.write('media/2025/a.jpg', blob('a'));
    expect(await sink.existing('media/2025/a.jpg')).toBe(1);
  });

  it('reads whose export the folder holds and what it wrote, from its living.json', async () => {
    const dir = new FakeDir('living-ada');
    await dir.put(
      'living.json',
      JSON.stringify({
        format: FORMAT,
        profile: { id: 'u_ADA' },
        files: ['README.md', 'media/2026/a.jpg', '../outside.txt', 'notes/mine.md', 'media/../x', 7]
      })
    );
    expect(await new FolderSink(dir.handle).previous()).toEqual({ ownerId: 'u_ADA', files: ['README.md', 'media/2026/a.jpg'] });
  });

  it('trusts no living.json of another program, nor a broken one', async () => {
    const other = new FakeDir('x');
    await other.put('living.json', JSON.stringify({ profile: { id: 'u_ADA' }, files: ['README.md'] }));
    expect(await new FolderSink(other.handle).previous()).toEqual({ ownerId: null, files: [] });
    const broken = new FakeDir('x');
    await broken.put('living.json', '{');
    expect(await new FolderSink(broken.handle).previous()).toEqual({ ownerId: null, files: [] });
    expect(await new FolderSink(new FakeDir('x').handle).previous()).toEqual({ ownerId: null, files: [] });
  });

  it('removes only its own files, and one already gone is no error', async () => {
    const dir = new FakeDir('living-ada');
    await dir.put('media/2026/a.jpg', 'a');
    await dir.put('notes.txt', 'mine');
    const sink = new FolderSink(dir.handle);
    await sink.remove('media/2026/a.jpg');
    await sink.remove('media/2026/a.jpg');
    await sink.remove('notes.txt');
    await sink.remove('media/2019/gone.jpg');
    expect([...dir.files().keys()]).toEqual(['notes.txt']);
  });
});

describe('isOurs', () => {
  it('takes the README and files in the export’s folders, nothing else and nothing outside', () => {
    expect(isOurs('README.md')).toBe(true);
    expect(isOurs('entries/2026/2026-11-16 随记.md')).toBe(true);
    expect(isOurs('media/undated/ph_1.jpg')).toBe(true);
    expect(isOurs('living.json')).toBe(false);
    expect(isOurs('media')).toBe(false);
    expect(isOurs('media/')).toBe(false);
    expect(isOurs('media/../living.json')).toBe(false);
    expect(isOurs('media/./a.jpg')).toBe(false);
    expect(isOurs('notes/a.md')).toBe(false);
    expect(isOurs('/media/a.jpg')).toBe(false);
  });
});
