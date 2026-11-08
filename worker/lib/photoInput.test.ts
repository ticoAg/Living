import { describe, expect, it } from 'vite-plus/test';
import { invalidMessage, rejectedInvalidMessage, show } from '../test-utils';
import {
  GEO_PRIVACIES,
  MAX_ORIGINAL_BYTES,
  MAX_REQUEST_BYTES,
  MAX_VARIANT_BYTES,
  POI_METHODS,
  VISIBILITIES,
  isFile,
  originalKind,
  parseCreateMeta,
  variantKind
} from './photoInput';

/** The smallest valid `meta`. */
const minimal = () => ({
  width: 4000,
  height: 3000,
  variantSizes: { s: [480, 360], m: [1600, 1200], l: [2560, 1920] }
});

describe('parseCreateMeta', () => {
  it('fills in the documented defaults for a minimal meta', () => {
    expect(parseCreateMeta(minimal())).toEqual({
      title: null,
      note: null,
      takenAt: null,
      tz: null,
      lat: null,
      lng: null,
      alt: null,
      heading: null,
      geoPrivacy: 'exact',
      city: null,
      district: null,
      poiId: null,
      newPoi: null,
      poiDistance: null,
      poiMethod: null,
      camera: null,
      lens: null,
      focal: null,
      focal35: null,
      aperture: null,
      shutter: null,
      iso: null,
      width: 4000,
      height: 3000,
      sizes: { s: [480, 360], m: [1600, 1200], l: [2560, 1920] },
      thumbhash: null,
      palette: null,
      focus: null,
      visibility: 'public',
      inLiving: true,
      favorite: false,
      sha256: null,
      tagIds: [],
      suggestedTagIds: [],
      themeIds: []
    });
  });

  it('normalises a fully populated meta', () => {
    const meta = parseCreateMeta({
      ...minimal(),
      title: '  断桥残雪  ',
      note: '清晨的断桥',
      takenAt: '2026-11-08T07:15:30+08:00',
      tz: '+08:00',
      lat: 30.2589,
      lng: 120.1494,
      alt: 12.5,
      heading: 370,
      geoPrivacy: 'fuzzy',
      city: '杭州',
      district: '西湖区',
      poiId: 'poi_01',
      poiDistance: 42.5,
      poiMethod: 'confirmed',
      camera: 'Sony ILCE-7M4',
      lens: 'FE 35mm F1.8',
      focal: 35,
      focal35: 35,
      aperture: 1.8,
      shutter: '1/250',
      iso: 100,
      thumbhash: 'YJqGPQw7sFlslqhFafSE+Q6oJ1h2iHB2Rw==',
      palette: ['#112233', 'not a colour', '#AABBCC'],
      focus: [0.4, 1.2],
      visibility: 'unlisted',
      inLiving: false,
      favorite: true,
      sha256: 'ABCDEF0123456789'.repeat(4),
      tagIds: ['lake', 'lake', 'bridge'],
      suggestedTagIds: ['sunrise'],
      themeIds: ['th_01']
    });
    expect(meta).toMatchObject({
      title: '断桥残雪',
      note: '清晨的断桥',
      // the wall-clock time is kept as written, whatever offset came with it
      takenAt: '2026-11-08T07:15:30',
      tz: '+08:00',
      lat: 30.2589,
      lng: 120.1494,
      alt: 12.5,
      heading: 10,
      geoPrivacy: 'fuzzy',
      city: '杭州',
      district: '西湖区',
      poiId: 'poi_01',
      poiDistance: 42.5,
      poiMethod: 'confirmed',
      camera: 'Sony ILCE-7M4',
      lens: 'FE 35mm F1.8',
      focal: 35,
      focal35: 35,
      aperture: 1.8,
      shutter: '1/250',
      iso: 100,
      thumbhash: 'YJqGPQw7sFlslqhFafSE+Q6oJ1h2iHB2Rw==',
      palette: ['#112233', '#AABBCC'],
      focus: [0.4, 1],
      visibility: 'unlisted',
      inLiving: false,
      favorite: true,
      sha256: 'abcdef0123456789'.repeat(4),
      tagIds: ['lake', 'bridge'],
      suggestedTagIds: ['sunrise'],
      themeIds: ['th_01']
    });
  });

  it('ignores keys it does not know, so a client cannot set other columns', () => {
    const meta = parseCreateMeta({ ...minimal(), ownerId: 'u_someone_else', id: 'ph_chosen', role: 'owner', uploadedAt: '2000-01-01' });
    expect(Object.keys(meta)).not.toContain('ownerId');
    expect(Object.keys(meta)).not.toContain('id');
    expect(Object.keys(meta)).not.toContain('role');
    expect(Object.keys(meta)).not.toContain('uploadedAt');
  });

  describe('shape', () => {
    it('must be a JSON object', () => {
      for (const bad of [null, undefined, [], [minimal()], 'meta', 5, true]) {
        expect(
          invalidMessage(() => parseCreateMeta(bad)),
          JSON.stringify(bad)
        ).toBe('meta 需要是一个 JSON 对象');
      }
    });

    it('needs the pixel width and height', () => {
      expect(invalidMessage(() => parseCreateMeta({ variantSizes: minimal().variantSizes }))).toBe('meta 里缺少图片的宽和高');
      expect(invalidMessage(() => parseCreateMeta({ ...minimal(), width: undefined }))).toBe('meta 里缺少图片的宽和高');
      expect(invalidMessage(() => parseCreateMeta({ ...minimal(), height: null }))).toBe('meta 里缺少图片的宽和高');
    });

    it('limits width and height to whole numbers from 1 to 20000', () => {
      expect(parseCreateMeta({ ...minimal(), width: 1, height: 20000 })).toMatchObject({ width: 1, height: 20000 });
      expect(invalidMessage(() => parseCreateMeta({ ...minimal(), width: 0 }))).toBe('图片宽度不能小于 1');
      expect(invalidMessage(() => parseCreateMeta({ ...minimal(), width: 20001 }))).toBe('图片宽度不能大于 20000');
      expect(invalidMessage(() => parseCreateMeta({ ...minimal(), height: 100.5 }))).toBe('图片高度需要是整数');
      expect(invalidMessage(() => parseCreateMeta({ ...minimal(), height: '3000' }))).toBe('图片高度需要是数字');
    });

    it('needs the pixel size of all three variants', () => {
      for (const bad of [undefined, null, [], 'sizes', 5]) {
        expect(
          invalidMessage(() => parseCreateMeta({ ...minimal(), variantSizes: bad })),
          show(bad)
        ).toBe('meta 里缺少 variantSizes（s、m、l 三种尺寸图的像素尺寸）');
      }
      const { s, m, l } = minimal().variantSizes;
      expect(invalidMessage(() => parseCreateMeta({ ...minimal(), variantSizes: { m, l } }))).toBe('小图尺寸需要是 [宽, 高]');
      expect(invalidMessage(() => parseCreateMeta({ ...minimal(), variantSizes: { s, l } }))).toBe('中图尺寸需要是 [宽, 高]');
      expect(invalidMessage(() => parseCreateMeta({ ...minimal(), variantSizes: { s, m } }))).toBe('大图尺寸需要是 [宽, 高]');
    });

    it('wants each variant size as [width, height] of whole pixels from 1 to 20000', () => {
      const { m, l } = minimal().variantSizes;
      const withSmall = (s: unknown) => () => parseCreateMeta({ ...minimal(), variantSizes: { s, m, l } });
      expect(invalidMessage(withSmall([480]))).toBe('小图尺寸需要是 [宽, 高]');
      expect(invalidMessage(withSmall([480, 360, 1]))).toBe('小图尺寸需要是 [宽, 高]');
      expect(invalidMessage(withSmall([480, null]))).toBe('小图尺寸需要是 [宽, 高]');
      expect(invalidMessage(withSmall({ w: 480, h: 360 }))).toBe('小图尺寸需要是 [宽, 高]');
      expect(invalidMessage(withSmall([0, 360]))).toBe('小图尺寸的宽不能小于 1');
      expect(invalidMessage(withSmall([480, 20001]))).toBe('小图尺寸的高不能大于 20000');
      expect(invalidMessage(withSmall([480.5, 360]))).toBe('小图尺寸的宽需要是整数');
      expect(invalidMessage(withSmall(['480', 360]))).toBe('小图尺寸的宽需要是数字');
    });
  });

  describe('position', () => {
    it('keeps a complete point', () => {
      expect(parseCreateMeta({ ...minimal(), lat: 30.2589, lng: 120.1494 })).toMatchObject({ lat: 30.2589, lng: 120.1494 });
      expect(parseCreateMeta({ ...minimal(), lat: -90, lng: -180 })).toMatchObject({ lat: -90, lng: -180 });
      expect(parseCreateMeta({ ...minimal(), lat: 90, lng: 180 })).toMatchObject({ lat: 90, lng: 180 });
      expect(parseCreateMeta({ ...minimal(), lat: 0, lng: 0 })).toMatchObject({ lat: 0, lng: 0 });
    });

    it('drops a stray half instead of storing it', () => {
      expect(parseCreateMeta({ ...minimal(), lat: 30.25 })).toMatchObject({ lat: null, lng: null });
      expect(parseCreateMeta({ ...minimal(), lng: 120.14 })).toMatchObject({ lat: null, lng: null });
      expect(parseCreateMeta({ ...minimal(), lat: 30.25, lng: null })).toMatchObject({ lat: null, lng: null });
    });

    it('rejects coordinates outside the globe', () => {
      expect(invalidMessage(() => parseCreateMeta({ ...minimal(), lat: 90.0001, lng: 0 }))).toBe('纬度不能大于 90');
      expect(invalidMessage(() => parseCreateMeta({ ...minimal(), lat: -91, lng: 0 }))).toBe('纬度不能小于 -90');
      expect(invalidMessage(() => parseCreateMeta({ ...minimal(), lat: 0, lng: 181 }))).toBe('经度不能大于 180');
      expect(invalidMessage(() => parseCreateMeta({ ...minimal(), lat: 0, lng: -181 }))).toBe('经度不能小于 -180');
      expect(invalidMessage(() => parseCreateMeta({ ...minimal(), lat: '30.25', lng: 120.14 }))).toBe('纬度需要是数字');
    });

    it('normalises the heading and bounds the altitude', () => {
      expect(parseCreateMeta({ ...minimal(), heading: -10 })).toMatchObject({ heading: 350 });
      expect(parseCreateMeta({ ...minimal(), heading: 0 })).toMatchObject({ heading: 0 });
      expect(invalidMessage(() => parseCreateMeta({ ...minimal(), heading: 1000 }))).toBe('朝向不能大于 720');
      expect(parseCreateMeta({ ...minimal(), alt: -430 })).toMatchObject({ alt: -430 });
      expect(parseCreateMeta({ ...minimal(), alt: 8848 })).toMatchObject({ alt: 8848 });
      expect(invalidMessage(() => parseCreateMeta({ ...minimal(), alt: -1001 }))).toBe('海拔不能小于 -1000');
      expect(invalidMessage(() => parseCreateMeta({ ...minimal(), alt: 100_001 }))).toBe('海拔不能大于 100000');
    });
  });

  describe('time', () => {
    it('accepts a local capture time and drops zone suffixes', () => {
      expect(parseCreateMeta({ ...minimal(), takenAt: '2026-11-08T14:05' })).toMatchObject({ takenAt: '2026-11-08T14:05:00' });
      expect(parseCreateMeta({ ...minimal(), takenAt: '2026-11-08T14:05:09Z' })).toMatchObject({ takenAt: '2026-11-08T14:05:09' });
    });

    it('rejects a malformed capture time', () => {
      expect(invalidMessage(() => parseCreateMeta({ ...minimal(), takenAt: '2026-11-08' }))).toBe('拍摄时间格式应为 YYYY-MM-DDTHH:mm:ss');
      expect(invalidMessage(() => parseCreateMeta({ ...minimal(), takenAt: '2026-02-30T10:00:00' }))).toBe(
        '拍摄时间格式应为 YYYY-MM-DDTHH:mm:ss'
      );
    });

    it('keeps the offset when it is valid and drops it quietly when it is not, since it is only descriptive', () => {
      expect(parseCreateMeta({ ...minimal(), tz: '-05:30' })).toMatchObject({ tz: '-05:30' });
      expect(parseCreateMeta({ ...minimal(), tz: 'Asia/Shanghai' })).toMatchObject({ tz: null });
      expect(parseCreateMeta({ ...minimal(), tz: 8 })).toMatchObject({ tz: null });
    });
  });

  describe('choices', () => {
    it('knows the documented values', () => {
      expect([...VISIBILITIES]).toEqual(['public', 'unlisted', 'private']);
      expect([...GEO_PRIVACIES]).toEqual(['exact', 'fuzzy', 'hidden']);
      expect([...POI_METHODS]).toEqual(['auto', 'confirmed', 'inferred', 'manual']);
    });

    it('accepts each of them', () => {
      for (const visibility of VISIBILITIES) expect(parseCreateMeta({ ...minimal(), visibility })).toMatchObject({ visibility });
      for (const geoPrivacy of GEO_PRIVACIES) expect(parseCreateMeta({ ...minimal(), geoPrivacy })).toMatchObject({ geoPrivacy });
      for (const poiMethod of POI_METHODS) expect(parseCreateMeta({ ...minimal(), poiMethod })).toMatchObject({ poiMethod });
    });

    it('rejects others, and takes a null poiMethod as none', () => {
      expect(invalidMessage(() => parseCreateMeta({ ...minimal(), visibility: 'secret' }))).toBe(
        '公开范围需要是 public / unlisted / private 之一'
      );
      expect(invalidMessage(() => parseCreateMeta({ ...minimal(), geoPrivacy: 'approx' }))).toBe(
        '位置精度需要是 exact / fuzzy / hidden 之一'
      );
      expect(invalidMessage(() => parseCreateMeta({ ...minimal(), poiMethod: 'guess' }))).toBe(
        '地点匹配方式需要是 auto / confirmed / inferred / manual 之一'
      );
      expect(parseCreateMeta({ ...minimal(), poiMethod: null })).toMatchObject({ poiMethod: null });
    });

    it('wants real booleans for the two switches', () => {
      expect(invalidMessage(() => parseCreateMeta({ ...minimal(), inLiving: 'yes' }))).toBe('inLiving需要是 true 或 false');
      expect(invalidMessage(() => parseCreateMeta({ ...minimal(), favorite: 1 }))).toBe('favorite需要是 true 或 false');
    });
  });

  describe('text and numbers', () => {
    it('treats blank text as absent and trims the rest', () => {
      expect(parseCreateMeta({ ...minimal(), title: '   ', note: '', city: null })).toMatchObject({ title: null, note: null, city: null });
      expect(parseCreateMeta({ ...minimal(), camera: '  X100V ' })).toMatchObject({ camera: 'X100V' });
    });

    it('enforces the length limits in characters', () => {
      expect(parseCreateMeta({ ...minimal(), title: '题'.repeat(200) })).toMatchObject({ title: '题'.repeat(200) });
      expect(invalidMessage(() => parseCreateMeta({ ...minimal(), title: '题'.repeat(201) }))).toBe('标题最多 200 个字符');
      expect(invalidMessage(() => parseCreateMeta({ ...minimal(), note: '笔'.repeat(5001) }))).toBe('笔记最多 5000 个字符');
      expect(invalidMessage(() => parseCreateMeta({ ...minimal(), city: '城'.repeat(61) }))).toBe('城市最多 60 个字符');
      expect(invalidMessage(() => parseCreateMeta({ ...minimal(), shutter: '1'.repeat(31) }))).toBe('快门最多 30 个字符');
      expect(invalidMessage(() => parseCreateMeta({ ...minimal(), title: 42 }))).toBe('标题需要是文字');
    });

    it('bounds the camera numbers', () => {
      expect(parseCreateMeta({ ...minimal(), focal: 0, aperture: 100, iso: 10_000_000 })).toMatchObject({
        focal: 0,
        aperture: 100,
        iso: 10_000_000
      });
      expect(invalidMessage(() => parseCreateMeta({ ...minimal(), iso: 100.5 }))).toBe('ISO需要是整数');
      expect(invalidMessage(() => parseCreateMeta({ ...minimal(), aperture: 101 }))).toBe('光圈不能大于 100');
      expect(invalidMessage(() => parseCreateMeta({ ...minimal(), focal: -1 }))).toBe('焦距不能小于 0');
      expect(invalidMessage(() => parseCreateMeta({ ...minimal(), poiDistance: -5 }))).toBe('地点距离不能小于 0');
    });
  });

  describe('sha256 and thumbhash', () => {
    it('takes 64 hex digits in either case and stores them lower-cased', () => {
      expect(parseCreateMeta({ ...minimal(), sha256: 'A'.repeat(64) })).toMatchObject({ sha256: 'a'.repeat(64) });
      expect(parseCreateMeta({ ...minimal(), sha256: '' })).toMatchObject({ sha256: null });
      expect(parseCreateMeta({ ...minimal(), sha256: null })).toMatchObject({ sha256: null });
    });

    it('rejects anything else', () => {
      for (const bad of ['a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), ` ${'a'.repeat(63)}`, 12345, true]) {
        expect(
          invalidMessage(() => parseCreateMeta({ ...minimal(), sha256: bad })),
          show(bad)
        ).toBe('sha256 需要是 64 位十六进制');
      }
    });

    it('limits thumbhash to base64 characters and 200 of them', () => {
      expect(parseCreateMeta({ ...minimal(), thumbhash: 'abc_DEF-123+/=' })).toMatchObject({ thumbhash: 'abc_DEF-123+/=' });
      expect(invalidMessage(() => parseCreateMeta({ ...minimal(), thumbhash: 'not base64!' }))).toBe('thumbhash 格式不对');
      expect(invalidMessage(() => parseCreateMeta({ ...minimal(), thumbhash: '<script>' }))).toBe('thumbhash 格式不对');
      expect(invalidMessage(() => parseCreateMeta({ ...minimal(), thumbhash: 'a'.repeat(201) }))).toBe('thumbhash最多 200 个字符');
    });
  });

  describe('lists', () => {
    it('removes repeated ids and keeps the order', () => {
      const meta = parseCreateMeta({ ...minimal(), tagIds: ['b', 'a', 'b'], suggestedTagIds: ['x', 'x'], themeIds: ['t1', 't1', 't2'] });
      expect(meta.tagIds).toEqual(['b', 'a']);
      expect(meta.suggestedTagIds).toEqual(['x']);
      expect(meta.themeIds).toEqual(['t1', 't2']);
    });

    it('limits their length and shape', () => {
      expect(invalidMessage(() => parseCreateMeta({ ...minimal(), tagIds: Array.from({ length: 201 }, (_, i) => `t${i}`) }))).toBe(
        '标签最多 200 项'
      );
      expect(invalidMessage(() => parseCreateMeta({ ...minimal(), themeIds: Array.from({ length: 51 }, (_, i) => `t${i}`) }))).toBe(
        '主题最多 50 项'
      );
      expect(invalidMessage(() => parseCreateMeta({ ...minimal(), tagIds: 'lake' }))).toBe('标签需要是数组');
      expect(invalidMessage(() => parseCreateMeta({ ...minimal(), suggestedTagIds: [1] }))).toBe('建议标签里有无效的值');
    });
  });

  describe('place', () => {
    const newPoi = { name: ' 湖心亭 ', category: '亭', lat: 30.2433, lng: 120.1399 };

    it('parses a new place and fills its defaults', () => {
      expect(parseCreateMeta({ ...minimal(), newPoi }).newPoi).toEqual({
        name: '湖心亭',
        category: '亭',
        lat: 30.2433,
        lng: 120.1399,
        city: null,
        district: null,
        source: 'custom',
        sourceId: null
      });
    });

    it('keeps a provider place with its source and id', () => {
      const parsed = parseCreateMeta({
        ...minimal(),
        newPoi: { ...newPoi, source: 'amap', sourceId: 'B0FFF1234', city: '杭州市', district: '西湖区' }
      });
      expect(parsed.newPoi).toMatchObject({ source: 'amap', sourceId: 'B0FFF1234', city: '杭州市', district: '西湖区' });
    });

    it('takes null or a missing newPoi as none', () => {
      expect(parseCreateMeta({ ...minimal(), newPoi: null }).newPoi).toBeNull();
      expect(parseCreateMeta(minimal()).newPoi).toBeNull();
    });

    it('rejects an invalid new place with the reason', () => {
      expect(invalidMessage(() => parseCreateMeta({ ...minimal(), newPoi: 'x' }))).toBe('地点信息格式不对');
      expect(invalidMessage(() => parseCreateMeta({ ...minimal(), newPoi: { ...newPoi, name: ' ' } }))).toBe(
        '地点名称不能为空，且最多 80 个字符'
      );
      expect(invalidMessage(() => parseCreateMeta({ ...minimal(), newPoi: { ...newPoi, category: '火星基地' } }))).toMatch(
        /^地点类别需要是：桥、堤、湖/
      );
      expect(invalidMessage(() => parseCreateMeta({ ...minimal(), newPoi: { name: '湖心亭', category: '亭' } }))).toBe(
        '请提供地点的经纬度'
      );
      expect(invalidMessage(() => parseCreateMeta({ ...minimal(), newPoi: { ...newPoi, source: 'google' } }))).toBe(
        '地点来源需要是 custom / amap / osm 之一'
      );
    });
  });
});

describe('originalKind', () => {
  it('maps the image MIME types to an extension and a canonical type', () => {
    expect(originalKind({ type: 'image/jpeg' })).toEqual({ ext: 'jpg', type: 'image/jpeg' });
    expect(originalKind({ type: 'image/png' })).toEqual({ ext: 'png', type: 'image/png' });
    expect(originalKind({ type: 'image/webp' })).toEqual({ ext: 'webp', type: 'image/webp' });
    expect(originalKind({ type: 'image/avif' })).toEqual({ ext: 'avif', type: 'image/avif' });
    expect(originalKind({ type: 'image/heic' })).toEqual({ ext: 'heic', type: 'image/heic' });
    expect(originalKind({ type: 'image/heif' })).toEqual({ ext: 'heif', type: 'image/heif' });
    expect(originalKind({ type: 'image/gif' })).toEqual({ ext: 'gif', type: 'image/gif' });
    expect(originalKind({ type: 'image/tiff' })).toEqual({ ext: 'tif', type: 'image/tiff' });
    expect(originalKind({ type: 'image/bmp' })).toEqual({ ext: 'bmp', type: 'image/bmp' });
  });

  it('turns the non-standard image/jpg into image/jpeg', () => {
    expect(originalKind({ type: 'image/jpg' })).toEqual({ ext: 'jpg', type: 'image/jpeg' });
  });

  it('ignores case and MIME parameters', () => {
    expect(originalKind({ type: 'IMAGE/PNG' })).toEqual({ ext: 'png', type: 'image/png' });
    expect(originalKind({ type: 'image/png; charset=binary' })).toEqual({ ext: 'png', type: 'image/png' });
    expect(originalKind({ type: ' image/webp ;q=1' })).toEqual({ ext: 'webp', type: 'image/webp' });
  });

  it('falls back to the file extension when the browser gives no usable type', () => {
    expect(originalKind({ type: '', name: 'IMG_0001.HEIC' })).toEqual({ ext: 'heic', type: 'image/heic' });
    expect(originalKind({ type: 'application/octet-stream', name: 'DSC01234.JPG' })).toEqual({ ext: 'jpg', type: 'image/jpeg' });
    expect(originalKind({ type: '', name: 'photo.jpeg' })).toEqual({ ext: 'jpg', type: 'image/jpeg' });
    expect(originalKind({ type: '', name: 'scan.tiff' })).toEqual({ ext: 'tif', type: 'image/tiff' });
    expect(originalKind({ type: '', name: 'my.holiday.photo.png' })).toEqual({ ext: 'png', type: 'image/png' });
  });

  it('prefers the MIME type over a misleading name', () => {
    expect(originalKind({ type: 'image/png', name: 'photo.jpg' })).toEqual({ ext: 'png', type: 'image/png' });
  });

  it('refuses things that are not images', () => {
    const message = '原图需要是图片文件（JPEG、PNG、WebP、AVIF、HEIC 等）';
    expect(invalidMessage(() => originalKind({ type: 'text/plain', name: 'notes.txt' }))).toBe(message);
    expect(invalidMessage(() => originalKind({ type: 'video/mp4', name: 'clip.mp4' }))).toBe(message);
    expect(invalidMessage(() => originalKind({ type: 'application/pdf' }))).toBe(message);
    expect(invalidMessage(() => originalKind({ type: '' }))).toBe(message);
    expect(invalidMessage(() => originalKind({ type: '', name: '' }))).toBe(message);
    expect(invalidMessage(() => originalKind({ type: '', name: 'archive.zip' }))).toBe(message);
    expect(invalidMessage(() => originalKind({ type: '', name: 'photo.jpg.exe' }))).toBe(message);
  });
});

describe('variantKind', () => {
  const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
  const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01];
  const WEBP = [...ascii('RIFF'), 0x24, 0x00, 0x00, 0x00, ...ascii('WEBP'), ...ascii('VP8 ')];
  const blob = (bytes: number[], type: string) => new Blob([Uint8Array.from(bytes)], { type });

  it('accepts a JPEG that starts like one', async () => {
    expect(await variantKind(blob(JPEG, 'image/jpeg'), '小图')).toEqual({ ext: 'jpg', type: 'image/jpeg' });
  });

  it('accepts a WebP that starts like one', async () => {
    expect(await variantKind(blob(WEBP, 'image/webp'), '小图')).toEqual({ ext: 'webp', type: 'image/webp' });
  });

  it('ignores MIME parameters and case', async () => {
    expect(await variantKind(blob(WEBP, 'image/webp; q=1'), '中图')).toEqual({ ext: 'webp', type: 'image/webp' });
    expect(await variantKind(blob(JPEG, 'IMAGE/JPEG'), '中图')).toEqual({ ext: 'jpg', type: 'image/jpeg' });
  });

  it('refuses every other declared type, naming the part', async () => {
    for (const type of ['image/png', 'image/gif', 'image/avif', 'text/html', 'image/svg+xml', '']) {
      expect(await rejectedInvalidMessage(variantKind(blob(JPEG, type), '大图')), type).toBe('大图需要是 image/webp 或 image/jpeg');
    }
  });

  it('refuses content that does not match the declared type', async () => {
    const mismatch = '小图的内容和它声明的格式不一致';
    expect(await rejectedInvalidMessage(variantKind(blob(WEBP, 'image/jpeg'), '小图'))).toBe(mismatch);
    expect(await rejectedInvalidMessage(variantKind(blob(JPEG, 'image/webp'), '小图'))).toBe(mismatch);
    expect(await rejectedInvalidMessage(variantKind(blob(ascii('<html><script>alert(1)</script>'), 'image/jpeg'), '小图'))).toBe(mismatch);
    expect(await rejectedInvalidMessage(variantKind(blob(ascii('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/webp'), '小图'))).toBe(
      mismatch
    );
  });

  it('refuses files too short to carry a header', async () => {
    const mismatch = '小图的内容和它声明的格式不一致';
    expect(await rejectedInvalidMessage(variantKind(blob([], 'image/jpeg'), '小图'))).toBe(mismatch);
    expect(await rejectedInvalidMessage(variantKind(blob([0xff, 0xd8], 'image/jpeg'), '小图'))).toBe(mismatch);
    expect(await rejectedInvalidMessage(variantKind(blob(WEBP.slice(0, 11), 'image/webp'), '小图'))).toBe(mismatch);
  });

  it('needs both the RIFF tag and the WEBP tag', async () => {
    const mismatch = '小图的内容和它声明的格式不一致';
    const riffOnly = [...ascii('RIFF'), 0x24, 0x00, 0x00, 0x00, ...ascii('WAVE')];
    const webpOnly = [...ascii('JUNK'), 0x24, 0x00, 0x00, 0x00, ...ascii('WEBP')];
    expect(await rejectedInvalidMessage(variantKind(blob(riffOnly, 'image/webp'), '小图'))).toBe(mismatch);
    expect(await rejectedInvalidMessage(variantKind(blob(webpOnly, 'image/webp'), '小图'))).toBe(mismatch);
  });
});

describe('isFile', () => {
  it('recognises files and blobs', () => {
    expect(isFile(new File(['x'], 'a.jpg', { type: 'image/jpeg' }))).toBe(true);
    expect(isFile(new Blob(['x']))).toBe(true);
  });

  it('rejects the string values a multipart form can also carry, and other junk', () => {
    expect(isFile('{"width":1}')).toBe(false);
    expect(isFile(null)).toBe(false);
    expect(isFile(undefined)).toBe(false);
    expect(isFile({})).toBe(false);
    expect(isFile({ size: 3 })).toBe(false);
    expect(isFile({ arrayBuffer: () => null })).toBe(false);
  });
});

describe('upload limits', () => {
  it('allow originals up to 50 MB, as documented', () => {
    expect(MAX_ORIGINAL_BYTES).toBe(50 * 1024 * 1024);
  });

  it('size the request guard to hold the original, three variants and some metadata', () => {
    expect(MAX_REQUEST_BYTES).toBeGreaterThan(MAX_ORIGINAL_BYTES + 3 * MAX_VARIANT_BYTES);
  });
});

// The original is stored as uploaded, so its content type and R2 key extension come from what the browser says about the file.
// HEIC is the case that matters: Chrome and Firefox upload iPhone photos they cannot decode themselves.
describe('originalKind: HEIC and HEIF originals', () => {
  it('uses the MIME type', () => {
    expect(originalKind({ type: 'image/heic', name: 'IMG_0001.HEIC' })).toEqual({ ext: 'heic', type: 'image/heic' });
    expect(originalKind({ type: 'image/heif', name: 'IMG_0001.HEIC' })).toEqual({ ext: 'heif', type: 'image/heif' });
  });

  it('ignores case and MIME parameters', () => {
    expect(originalKind({ type: 'IMAGE/HEIC; charset=binary' })).toEqual({ ext: 'heic', type: 'image/heic' });
  });

  it('falls back to the extension when the browser reports no type or a generic one (Windows, Linux)', () => {
    expect(originalKind({ type: '', name: 'IMG_0042.HEIC' })).toEqual({ ext: 'heic', type: 'image/heic' });
    expect(originalKind({ type: '', name: 'holiday.heif' })).toEqual({ ext: 'heif', type: 'image/heif' });
    expect(originalKind({ type: 'application/octet-stream', name: 'IMG_0042.heic' })).toEqual({ ext: 'heic', type: 'image/heic' });
  });

  it('still refuses files that are not images', () => {
    expect(() => originalKind({ type: 'text/plain', name: 'notes.txt' })).toThrow();
    expect(() => originalKind({ type: '', name: 'IMG_0042' })).toThrow();
  });
});
