// Where an export's files go: ZIP parts built in memory and handed over one by one, or a folder on this computer
// (Chrome and Edge), where a later export updates the earlier one. Docs: /docs/product/features/export.md

import { FORMAT } from './archive';
import { crc32Blob } from './crc32';
import { ZIP_MAX_ENTRIES, ZipWriter } from './zip';

/** What an earlier export to the same place left: whose it was and the files it wrote (its living.json lists them). */
export interface Previous {
  ownerId: string | null;
  files: string[];
}

export interface ExportSink {
  /** The size of the file at `path` from an earlier export (a folder), or null. */
  existing(path: string): Promise<number | null>;
  write(path: string, data: Blob, mtime: Date): Promise<void>;
  previous(): Promise<Previous>;
  remove(path: string): Promise<void>;
  close(): Promise<void>;
}

/** A ZIP part holds at most this much; the next file starts a new one. */
export const PART_BYTES = 1024 ** 3;

/** ZIP parts, each a whole archive under the same root folder: unzipped to one place, they make the one folder. */
export class ZipSink implements ExportSink {
  #zip = new ZipWriter();
  #parts = 0;

  constructor(
    private readonly root: string,
    /** a part is done: `index` counts from 1, and `last` is the one close() finished */
    private readonly onPart: (blob: Blob, index: number, last: boolean) => void,
    private readonly partBytes = PART_BYTES
  ) {}

  async existing(): Promise<null> {
    return null;
  }

  async previous(): Promise<Previous> {
    return { ownerId: null, files: [] };
  }

  async remove(): Promise<void> {}

  async write(path: string, data: Blob, mtime: Date): Promise<void> {
    const name = `${this.root}/${path}`;
    const full =
      this.#zip.count > 0 &&
      (this.#zip.finishedSize + ZipWriter.cost(name, data.size) > this.partBytes || this.#zip.count >= ZIP_MAX_ENTRIES);
    if (full) this.#cut(false);
    this.#zip.add(name, data, await crc32Blob(data), mtime);
  }

  async close(): Promise<void> {
    this.#cut(true);
  }

  #cut(last: boolean) {
    const blob = this.#zip.finish();
    this.#zip = new ZipWriter();
    this.onPart(blob, ++this.#parts, last);
  }
}

const OUR_FOLDERS = new Set(['entries', 'projects', 'collections', 'media']);

/** A path an export writes: tidying up never touches anything else in the folder, nor leaves it. */
export function isOurs(path: string): boolean {
  if (path === 'README.md') return true;
  const parts = path.split('/');
  return parts.length >= 2 && OUR_FOLDERS.has(parts[0]) && parts.every((p) => p !== '' && p !== '.' && p !== '..');
}

/** A folder on this computer, through the File System Access API. The handle is the export's own root folder. */
export class FolderSink implements ExportSink {
  #dirs = new Map<string, Promise<FileSystemDirectoryHandle>>();
  #previous?: Promise<Previous>;

  constructor(private readonly root: FileSystemDirectoryHandle) {}

  /** The folder holding `path`, made on the way when `create`. */
  #dir(path: string, create: boolean): Promise<FileSystemDirectoryHandle> {
    const parts = path.split('/').slice(0, -1);
    let at: Promise<FileSystemDirectoryHandle> = Promise.resolve(this.root);
    let key = '';
    for (const p of parts) {
      key = key ? `${key}/${p}` : p;
      const cached = this.#dirs.get(key);
      if (cached) {
        at = cached;
        continue;
      }
      const next = at.then((d) => d.getDirectoryHandle(p, { create }));
      // a lookup that failed (no such folder yet) is not remembered
      if (create) this.#dirs.set(key, next);
      at = next;
    }
    return at;
  }

  async existing(path: string): Promise<number | null> {
    try {
      const dir = await this.#dir(path, false);
      const file = await (await dir.getFileHandle(path.split('/').pop() as string)).getFile();
      return file.size;
    } catch {
      return null;
    }
  }

  async write(path: string, data: Blob): Promise<void> {
    const dir = await this.#dir(path, true);
    const handle = await dir.getFileHandle(path.split('/').pop() as string, { create: true });
    const out = await handle.createWritable();
    try {
      await out.write(data);
      await out.close();
    } catch (e) {
      await out.abort().catch(() => {});
      throw e;
    }
  }

  /** Reads the living.json an earlier export left, once. */
  async previous(): Promise<Previous> {
    return (this.#previous ??= (async () => {
      try {
        const text = await (await (await this.root.getFileHandle('living.json')).getFile()).text();
        const json = JSON.parse(text) as { format?: unknown; profile?: { id?: unknown }; files?: unknown };
        // some other program's living.json says nothing about this folder
        if (json.format !== FORMAT) return { ownerId: null, files: [] };
        const files = Array.isArray(json.files) ? json.files.filter((f): f is string => typeof f === 'string' && isOurs(f)) : [];
        return { ownerId: typeof json.profile?.id === 'string' ? json.profile.id : null, files };
      } catch {
        return { ownerId: null, files: [] };
      }
    })());
  }

  async remove(path: string): Promise<void> {
    if (!isOurs(path)) return;
    try {
      await (await this.#dir(path, false)).removeEntry(path.split('/').pop() as string);
    } catch {
      // already gone
    }
  }

  async close(): Promise<void> {}
}

interface DirectoryPicker {
  showDirectoryPicker(options?: { id?: string; mode?: 'read' | 'readwrite' }): Promise<FileSystemDirectoryHandle>;
}

/** This browser can write to a folder the user picks (Chrome, Edge; not Firefox or Safari). */
export const canPickFolder = (): boolean => typeof window !== 'undefined' && 'showDirectoryPicker' in window;

/**
 * Asks for a folder and opens (or makes) the export's root folder inside it; the root folder itself, picked again,
 * is taken as it is. Must run in the click that asked for it. Rejects with AbortError if cancelled.
 */
export async function pickFolder(root: string): Promise<FileSystemDirectoryHandle> {
  const picked = await (window as unknown as DirectoryPicker).showDirectoryPicker({ id: 'living-export', mode: 'readwrite' });
  return picked.name === root ? picked : picked.getDirectoryHandle(root, { create: true });
}
