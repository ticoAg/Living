// What an import reads from: an export's folder, picked as a folder, or its ZIP parts, picked together. Either way,
// the files under the export's own folder (living-<handle>/) by their path there; an import only reads living.json and
// the photos' files. Docs: /docs/product/features/import.md

import { zipEntries, ZipError, zipRead } from './unzip';

export interface SourceFile {
  size: number;
  read(): Promise<Blob>;
}

export interface ImportSource {
  /** path under the export's folder → the file */
  files: Map<string, SourceFile>;
  /** the export's folder, as it is named */
  root: string;
}

/** A pick that holds no export, said for the person who picked it. */
export class SourceError extends Error {}

const JSON_NAME = 'living.json';

/** The export among `paths`: the folder of the living.json nearest the top. */
export function rootOf(paths: string[]): string {
  const found = paths.filter((p) => p === JSON_NAME || p.endsWith(`/${JSON_NAME}`));
  if (!found.length) throw new SourceError('没有找到 living.json：请选导出的文件夹（living-用户名），或者导出的全部 zip');
  const depth = (p: string) => p.split('/').length;
  const top = Math.min(...found.map(depth));
  const nearest = found.filter((p) => depth(p) === top);
  if (nearest.length > 1) throw new SourceError('选中的不止一份导出，请只选其中一份');
  return nearest[0].slice(0, -JSON_NAME.length).replace(/\/$/, '');
}

function under(root: string, entries: Iterable<[string, SourceFile]>): ImportSource {
  const prefix = root ? `${root}/` : '';
  const files = new Map<string, SourceFile>();
  for (const [path, f] of entries) if (path.startsWith(prefix)) files.set(path.slice(prefix.length), f);
  return { files, root: root.split('/').pop() ?? '' };
}

/** The files of a folder picked with `<input webkitdirectory>`, by their path from the folder picked. */
export function folderSource(picked: readonly File[]): ImportSource {
  const entries: [string, SourceFile][] = picked.map((f) => [
    (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
    { size: f.size, read: async () => f }
  ]);
  return under(rootOf(entries.map(([p]) => p)), entries);
}

/** The files of ZIP parts picked together; one that is not a ZIP, or not all of one, is said by its name. */
export async function zipSource(zips: readonly File[]): Promise<ImportSource> {
  const entries: [string, SourceFile][] = [];
  for (const zip of zips) {
    let list;
    try {
      list = await zipEntries(zip);
    } catch (e) {
      throw new SourceError(`${zip.name}：${e instanceof ZipError ? e.message : '读不出来'}`);
    }
    for (const entry of list) entries.push([entry.name, { size: entry.size, read: () => zipRead(zip, entry) }]);
  }
  return under(rootOf(entries.map(([p]) => p)), entries);
}
