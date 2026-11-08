import { describe, expect, it } from 'vite-plus/test';
import {
  HttpError,
  ID_RE,
  conflict,
  duplicate,
  etagMatches,
  forbidden,
  invalid,
  listCache,
  notFound,
  paramId,
  rateLimited,
  readJson,
  tooLarge,
  unauthenticated,
  upstream,
  type Ctx
} from './http';

/** Just enough of a Hono context for the helpers under test. */
function fakeCtx(parts: { headers?: Record<string, string>; body?: string | Error; params?: Record<string, string> } = {}) {
  const sent: Record<string, string> = {};
  const headers = new Map(Object.entries(parts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const c = {
    req: {
      header: (name: string) => headers.get(name.toLowerCase()),
      text: async () => {
        if (parts.body instanceof Error) throw parts.body;
        return parts.body ?? '';
      },
      param: (name: string) => parts.params?.[name]
    },
    header: (name: string, value: string) => {
      sent[name] = value;
    }
  } as unknown as Ctx;
  return { c, sent };
}

/** The error a promise rejects with, which must be an HttpError. */
async function rejection(promise: Promise<unknown>): Promise<HttpError> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof HttpError) return e;
    throw e;
  }
  throw new Error('expected the promise to reject');
}

describe('error helpers', () => {
  // docs/api/conventions.md#错误
  const contract: [string, HttpError, number, string][] = [
    ['invalid', invalid('x'), 400, 'invalid_input'],
    ['unauthenticated', unauthenticated(), 401, 'unauthenticated'],
    ['forbidden', forbidden(), 403, 'forbidden'],
    ['notFound', notFound(), 404, 'not_found'],
    ['conflict', conflict('x'), 409, 'conflict'],
    ['duplicate', duplicate('x'), 409, 'duplicate'],
    ['tooLarge', tooLarge('x'), 413, 'too_large'],
    ['rateLimited', rateLimited('x'), 429, 'rate_limited'],
    ['upstream', upstream('x'), 502, 'upstream_failed']
  ];

  it.each(contract)('%s is an HttpError with the documented status and code', (_name, error, status, code) => {
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(status);
    expect(error.code).toBe(code);
  });

  it('carry the message they are given', () => {
    expect(invalid('用户名需要 3 到 24 个字符').message).toBe('用户名需要 3 到 24 个字符');
    expect(tooLarge('原图太大').message).toBe('原图太大');
  });

  it('have Chinese default messages where the caller gives none', () => {
    expect(unauthenticated().message).toBe('请先登录');
    expect(forbidden().message).toBe('你没有权限执行这个操作');
    expect(notFound().message).toBe('内容不存在，或你没有权限查看');
    expect(unauthenticated('登录已过期').message).toBe('登录已过期');
  });

  it('can carry extra fields for the JSON body, such as the photo a duplicate upload matches', () => {
    expect(duplicate('这张照片已经上传过了', { photoId: 'ph_1' }).extra).toEqual({ photoId: 'ph_1' });
    expect(conflict('重名', { field: 'name' }).extra).toEqual({ field: 'name' });
    expect(invalid('x').extra).toEqual({});
  });
});

describe('ID_RE', () => {
  it('accepts the shapes of ids used in paths', () => {
    for (const ok of [
      'ph_01HZX3Q8V5N7Y2K4M6P8R0T1WA',
      'u_01HZX3Q8V5N7Y2K4M6P8R0T1WA',
      'lake',
      'night-sky',
      'A2B3C4D5E6',
      'x',
      'a'.repeat(64)
    ]) {
      expect(ID_RE.test(ok), ok).toBe(true);
    }
  });

  it('rejects anything that could change the meaning of a path or a query', () => {
    for (const bad of ['', 'a'.repeat(65), 'a/b', '../etc', '..', 'a b', 'a%20b', 'a.b', 'a?b', 'a#b', '湖', 'a\nb', "x'--", 'a;b']) {
      expect(ID_RE.test(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('paramId', () => {
  it('returns a well-formed path parameter', () => {
    expect(paramId(fakeCtx({ params: { id: 'ph_01HZX3Q8V5N7Y2K4M6P8R0T1WA' } }).c)).toBe('ph_01HZX3Q8V5N7Y2K4M6P8R0T1WA');
    expect(paramId(fakeCtx({ params: { photoId: 'lake' } }).c, 'photoId')).toBe('lake');
  });

  it('answers 404, not 400, for a malformed or missing one, so probing reveals nothing', () => {
    const malformed: Record<string, string>[] = [{ id: '../etc' }, { id: '' }, { id: 'a'.repeat(65) }, {}];
    for (const params of malformed) {
      let error: unknown;
      try {
        paramId(fakeCtx({ params }).c);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(HttpError);
      expect(error).toMatchObject({ status: 404, code: 'not_found' });
    }
  });
});

describe('etagMatches', () => {
  it('is false without an If-None-Match header', () => {
    expect(etagMatches(null, '"abc"')).toBe(false);
    expect(etagMatches(undefined, '"abc"')).toBe(false);
    expect(etagMatches('', '"abc"')).toBe(false);
  });

  it('matches the same tag', () => {
    expect(etagMatches('"abc"', '"abc"')).toBe(true);
    expect(etagMatches('"abd"', '"abc"')).toBe(false);
  });

  it('treats weak and strong forms of a tag alike', () => {
    expect(etagMatches('W/"abc"', '"abc"')).toBe(true);
    expect(etagMatches('"abc"', 'W/"abc"')).toBe(true);
    expect(etagMatches('W/"abc"', 'W/"abc"')).toBe(true);
  });

  it('searches a comma-separated list, ignoring spaces', () => {
    expect(etagMatches('"a", "b" ,W/"abc"', '"abc"')).toBe(true);
    expect(etagMatches('"a","b","c"', '"d"')).toBe(false);
    expect(etagMatches('  "abc"  ', '"abc"')).toBe(true);
  });

  it('matches anything for *', () => {
    expect(etagMatches('*', '"whatever"')).toBe(true);
    expect(etagMatches(' * ', '"whatever"')).toBe(true);
  });
});

describe('readJson', () => {
  it('parses a JSON object body', async () => {
    const { c } = fakeCtx({ body: '{"name":"西湖","n":[1,2]}' });
    expect(await readJson(c)).toEqual({ name: '西湖', n: [1, 2] });
  });

  it('answers 400 with a Chinese message for broken JSON', async () => {
    const error = await rejection(readJson(fakeCtx({ body: '{"name":' }).c));
    expect(error).toMatchObject({ status: 400, code: 'invalid_input', message: '请求内容不是有效的 JSON' });
  });

  it('answers 400 for JSON that is not an object', async () => {
    for (const body of ['[1,2]', '"text"', '42', 'null', 'true', '']) {
      const error = await rejection(readJson(fakeCtx({ body }).c));
      expect(error.status, body).toBe(400);
      expect(error.code, body).toBe('invalid_input');
    }
    expect((await rejection(readJson(fakeCtx({ body: '[1]' }).c))).message).toBe('请求内容需要是一个 JSON 对象');
  });

  it('answers 400 when the body cannot be read', async () => {
    const error = await rejection(readJson(fakeCtx({ body: new Error('stream closed') }).c));
    expect(error).toMatchObject({ status: 400, message: '无法读取请求内容' });
  });

  it('answers 413 when Content-Length already says the body is too big, without reading it', async () => {
    const { c } = fakeCtx({ headers: { 'content-length': '300000' }, body: new Error('must not be read') });
    expect(await rejection(readJson(c))).toMatchObject({ status: 413, code: 'too_large', message: '请求内容太大' });
  });

  it('answers 413 when the body turns out bigger than the limit', async () => {
    const big = JSON.stringify({ text: 'x'.repeat(300_000) });
    expect(await rejection(readJson(fakeCtx({ body: big }).c))).toMatchObject({ status: 413, code: 'too_large' });
  });

  it('honours a custom limit, inclusive', async () => {
    const body = '{"a":"bcd"}';
    expect(await readJson(fakeCtx({ body }).c, body.length)).toEqual({ a: 'bcd' });
    expect(await rejection(readJson(fakeCtx({ body }).c, body.length - 1))).toMatchObject({ status: 413 });
    expect(
      await rejection(readJson(fakeCtx({ headers: { 'content-length': String(body.length) }, body }).c, body.length - 1))
    ).toMatchObject({
      status: 413
    });
  });

  it('ignores a malformed Content-Length rather than failing', async () => {
    expect(await readJson(fakeCtx({ headers: { 'content-length': 'abc' }, body: '{"a":1}' }).c)).toEqual({ a: 1 });
  });
});

describe('listCache', () => {
  it('lets anonymous list responses be cached for 30 seconds', () => {
    const { c, sent } = fakeCtx();
    listCache(c, null);
    expect(sent['Cache-Control']).toBe('public, max-age=30');
    expect(sent['Vary']).toBe('Cookie');
  });

  it('never caches a response made for a signed-in viewer', () => {
    const { c, sent } = fakeCtx();
    listCache(c, 'u_1');
    expect(sent['Cache-Control']).toBe('private, no-store');
    expect(sent['Vary']).toBe('Cookie');
  });
});
