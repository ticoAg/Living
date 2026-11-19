import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import type { AttachmentUpload, OwnAttachment } from '../../shared/types';
import { attachment } from '../test-utils';
import { ApiError } from '../lib/api';
import { RETRY_WAIT, sendParts, type PutBytes, type Sending } from './upload';

const own = (over: Partial<OwnAttachment> = {}): OwnAttachment => ({ ...attachment('at_1'), state: 'uploading', entryId: null, ...over });
const upload = (size: number, partBytes = 4): AttachmentUpload => ({
  attachment: own({ size }),
  partBytes,
  parts: Math.max(1, Math.ceil(size / partBytes))
});

/** The Worker's answers to PUT parts (`put`) and to the requests through fetch (complete). */
function worker(answers: ((n: number, body: string) => { status: number; body?: unknown } | Error)[] = []) {
  const w = {
    puts: [] as [number, string][],
    completed: null as unknown,
    put: (async (url, body, onProgress) => {
      const n = Number(/\/parts\/(\d+)$/.exec(url)?.[1]);
      const text = await body.text();
      w.puts.push([n, text]);
      const answer = answers.shift()?.(n, text) ?? { status: 200 };
      if (answer instanceof Error) throw answer;
      onProgress(body.size);
      return { status: answer.status, body: answer.body ?? { partNumber: n, etag: `e${n}` } };
    }) as PutBytes
  };
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    w.completed = JSON.parse(init?.body as string);
    expect(input).toBe('/api/attachments/at_1/complete');
    return new Response(JSON.stringify({ attachment: own({ state: 'loose' }) }), { status: 200 });
  });
  return w;
}

afterEach(() => vi.unstubAllGlobals());

const file = new Blob(['abcdefghij']);
const noWait = async () => undefined;

describe('sendParts', () => {
  it('sends the parts in order, each as long as the upload says, then completes it with them all', async () => {
    const w = worker();
    const progress: number[] = [];
    const s: Sending = { upload: upload(10), done: [] };
    const done = await sendParts(s, file, { put: w.put, onProgress: (sent, total) => progress.push(sent / total) });
    expect(done.state).toBe('loose');
    expect(w.puts).toEqual([
      [1, 'abcd'],
      [2, 'efgh'],
      [3, 'ij']
    ]);
    expect(w.completed).toEqual({
      parts: [
        { partNumber: 1, etag: 'e1' },
        { partNumber: 2, etag: 'e2' },
        { partNumber: 3, etag: 'e3' }
      ]
    });
    expect(progress.at(-1)).toBe(1);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
  });

  it('tries a part again after 1, 4 and 15 seconds when the network or the server fails, then gives up', async () => {
    const waits: number[] = [];
    const sleep = async (ms: number) => void waits.push(ms);
    const w = worker([() => new TypeError('network'), () => ({ status: 503 }), () => ({ status: 429 }), () => ({ status: 200 })]);
    await sendParts({ upload: upload(4), done: [] }, new Blob(['abcd']), { put: w.put, sleep });
    expect(waits).toEqual(RETRY_WAIT);
    expect(w.puts).toHaveLength(4);

    const down = worker(
      Array.from({ length: 4 }, () => () => ({ status: 502, body: { error: 'upstream_failed', message: '存储服务暂时不可用' } }))
    );
    await expect(sendParts({ upload: upload(4), done: [] }, new Blob(['abcd']), { put: down.put, sleep: noWait })).rejects.toMatchObject({
      status: 502,
      message: '存储服务暂时不可用'
    });
    expect(down.puts).toHaveLength(4);
  });

  it('does not try again what the Worker refused, and says why', async () => {
    const w = worker([() => ({ status: 400, body: { error: 'invalid_input', message: '第 1 片应该是 4 字节' } })]);
    const err = await sendParts({ upload: upload(4), done: [] }, new Blob(['abcd']), { put: w.put, sleep: noWait }).catch(
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, message: '第 1 片应该是 4 字节' });
    expect(w.puts).toHaveLength(1);
  });

  it('goes on after a failure from the part it stopped at', async () => {
    const w = worker([() => ({ status: 200 }), () => ({ status: 400 })]);
    const s: Sending = { upload: upload(10), done: [] };
    await expect(sendParts(s, file, { put: w.put, sleep: noWait })).rejects.toBeInstanceOf(ApiError);
    expect(s.done).toEqual([{ partNumber: 1, etag: 'e1' }]);
    const progress: number[] = [];
    await sendParts(s, file, { put: w.put, onProgress: (sent) => progress.push(sent) });
    expect(w.puts.map(([n]) => n)).toEqual([1, 2, 2, 3]);
    expect(progress[0]).toBe(4);
    expect((w.completed as { parts: unknown[] }).parts).toHaveLength(3);
  });

  it('stops when cancelled, and waits for no retry', async () => {
    const stop = new AbortController();
    const w = worker([
      () => {
        stop.abort();
        return new TypeError('network');
      }
    ]);
    await expect(sendParts({ upload: upload(10), done: [] }, file, { put: w.put, signal: stop.signal })).rejects.toThrow();
    expect(w.puts).toHaveLength(1);
    expect(w.completed).toBeNull();
  });
});
