import { describe, expect, it } from 'vite-plus/test';
import { invalidMessage, show } from '../test-utils';
import {
  cpLen,
  has,
  isDate,
  isPlainObject,
  optBool,
  optColor,
  optDate,
  optEnum,
  optFocus,
  optHeading,
  optNum,
  optPalette,
  optTakenAt,
  optText,
  optTz,
  reqNum,
  reqStr,
  strArray
} from './validate';

describe('has', () => {
  it('is true for an own key with a defined value, null included', () => {
    expect(has({ a: 1 }, 'a')).toBe(true);
    expect(has({ a: null }, 'a')).toBe(true);
    expect(has({ a: '' }, 'a')).toBe(true);
    expect(has({ a: 0 }, 'a')).toBe(true);
  });

  it('is false for missing, undefined and inherited keys', () => {
    expect(has({}, 'a')).toBe(false);
    expect(has({ a: undefined }, 'a')).toBe(false);
    expect(has({}, 'toString')).toBe(false);
    expect(has({}, '__proto__')).toBe(false);
  });
});

describe('cpLen', () => {
  it('counts code points, so Chinese and emoji are one each', () => {
    expect(cpLen('')).toBe(0);
    expect(cpLen('abc')).toBe(3);
    expect(cpLen('杭州西湖')).toBe(4);
    expect(cpLen('😀')).toBe(1);
    expect(cpLen('a😀b')).toBe(3);
    expect('😀'.length).toBe(2);
  });
});

describe('isPlainObject', () => {
  it('accepts objects and rejects arrays, null and primitives', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject(undefined)).toBe(false);
    expect(isPlainObject('x')).toBe(false);
    expect(isPlainObject(1)).toBe(false);
  });
});

describe('reqStr', () => {
  it('returns the trimmed string', () => {
    expect(reqStr({ name: '  西湖  ' }, 'name', '名称', 1, 10)).toBe('西湖');
  });

  it('accepts lengths from min to max inclusive, counting code points', () => {
    expect(reqStr({ n: 'ab' }, 'n', '用户名', 2, 4)).toBe('ab');
    expect(reqStr({ n: 'abcd' }, 'n', '用户名', 2, 4)).toBe('abcd');
    expect(reqStr({ n: '杭州西湖' }, 'n', '用户名', 2, 4)).toBe('杭州西湖');
    expect(reqStr({ n: '😀😀😀😀' }, 'n', '用户名', 2, 4)).toBe('😀😀😀😀');
  });

  it('asks for the field when it is missing or not a string', () => {
    expect(invalidMessage(() => reqStr({}, 'name', '名称', 1, 10))).toBe('请填写名称');
    expect(invalidMessage(() => reqStr({ name: null }, 'name', '名称', 1, 10))).toBe('请填写名称');
    expect(invalidMessage(() => reqStr({ name: 12 }, 'name', '名称', 1, 10))).toBe('请填写名称');
    expect(invalidMessage(() => reqStr({ name: ['x'] }, 'name', '名称', 1, 10))).toBe('请填写名称');
  });

  it('rejects blank and over-long text with a message that names the limit', () => {
    expect(invalidMessage(() => reqStr({ name: '' }, 'name', '名称', 1, 10))).toBe('名称不能为空，且最多 10 个字符');
    expect(invalidMessage(() => reqStr({ name: '   ' }, 'name', '名称', 1, 10))).toBe('名称不能为空，且最多 10 个字符');
    expect(invalidMessage(() => reqStr({ name: '12345678901' }, 'name', '名称', 1, 10))).toBe('名称不能为空，且最多 10 个字符');
    expect(invalidMessage(() => reqStr({ n: 'a' }, 'n', '用户名', 3, 24))).toBe('用户名需要 3 到 24 个字符');
    expect(invalidMessage(() => reqStr({ n: 'a'.repeat(25) }, 'n', '用户名', 3, 24))).toBe('用户名需要 3 到 24 个字符');
    expect(invalidMessage(() => reqStr({ n: '😀😀😀😀😀' }, 'n', '用户名', 2, 4))).toBe('用户名需要 2 到 4 个字符');
  });

  it('measures length after trimming', () => {
    expect(reqStr({ n: ' ab ' }, 'n', '用户名', 2, 2)).toBe('ab');
    expect(invalidMessage(() => reqStr({ n: ' a ' }, 'n', '用户名', 2, 4))).toBe('用户名需要 2 到 4 个字符');
  });
});

describe('optText', () => {
  it('treats null, undefined and blank text as absent', () => {
    expect(optText(null, '标题', 5)).toBeNull();
    expect(optText(undefined, '标题', 5)).toBeNull();
    expect(optText('', '标题', 5)).toBeNull();
    expect(optText('  \n\t ', '标题', 5)).toBeNull();
  });

  it('returns trimmed text up to the limit', () => {
    expect(optText('  西湖  ', '标题', 5)).toBe('西湖');
    expect(optText('12345', '标题', 5)).toBe('12345');
  });

  it('rejects non-strings and over-long text', () => {
    expect(invalidMessage(() => optText(5, '标题', 5))).toBe('标题需要是文字');
    expect(invalidMessage(() => optText({}, '标题', 5))).toBe('标题需要是文字');
    expect(invalidMessage(() => optText('123456', '标题', 5))).toBe('标题最多 5 个字符');
    expect(invalidMessage(() => optText('😀'.repeat(6), '标题', 5))).toBe('标题最多 5 个字符');
  });
});

describe('optNum / reqNum', () => {
  it('treats null and undefined as absent', () => {
    expect(optNum(null, '焦距')).toBeNull();
    expect(optNum(undefined, '焦距')).toBeNull();
  });

  it('returns finite numbers within the limits, edges included', () => {
    expect(optNum(0, '值')).toBe(0);
    expect(optNum(-3.5, '值')).toBe(-3.5);
    expect(optNum(5, '值', { min: 5, max: 10 })).toBe(5);
    expect(optNum(10, '值', { min: 5, max: 10 })).toBe(10);
    expect(optNum(7, '值', { int: true })).toBe(7);
  });

  it('rejects anything that is not a finite number', () => {
    for (const bad of ['5', true, [], {}, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(
        invalidMessage(() => optNum(bad, '焦距')),
        show(bad)
      ).toBe('焦距需要是数字');
    }
  });

  it('enforces int, min and max', () => {
    expect(invalidMessage(() => optNum(1.5, 'ISO', { int: true }))).toBe('ISO需要是整数');
    expect(invalidMessage(() => optNum(4.99, '值', { min: 5 }))).toBe('值不能小于 5');
    expect(invalidMessage(() => optNum(10.01, '值', { max: 10 }))).toBe('值不能大于 10');
    expect(invalidMessage(() => optNum(-1, '值', { min: 0, max: 10 }))).toBe('值不能小于 0');
  });

  it('reqNum insists on a value', () => {
    expect(reqNum(3, '半径', { min: 1 })).toBe(3);
    expect(invalidMessage(() => reqNum(null, '半径'))).toBe('请填写半径');
    expect(invalidMessage(() => reqNum(undefined, '半径'))).toBe('请填写半径');
    expect(invalidMessage(() => reqNum('3', '半径'))).toBe('半径需要是数字');
    expect(invalidMessage(() => reqNum(0, '半径', { min: 1 }))).toBe('半径不能小于 1');
  });
});

describe('optEnum', () => {
  const values = ['public', 'unlisted', 'private'] as const;

  it('returns a listed value, and undefined when absent', () => {
    expect(optEnum('unlisted', '公开范围', values)).toBe('unlisted');
    expect(optEnum(undefined, '公开范围', values)).toBeUndefined();
  });

  it('rejects other values and lists the choices', () => {
    expect(invalidMessage(() => optEnum('secret', '公开范围', values))).toBe('公开范围需要是 public / unlisted / private 之一');
    expect(invalidMessage(() => optEnum('PUBLIC', '公开范围', values))).toBe('公开范围需要是 public / unlisted / private 之一');
    expect(invalidMessage(() => optEnum(1, '公开范围', values))).toBe('公开范围需要是 public / unlisted / private 之一');
    expect(invalidMessage(() => optEnum('', '公开范围', values))).toBe('公开范围需要是 public / unlisted / private 之一');
  });

  it('does not accept null: callers map it to undefined first', () => {
    expect(invalidMessage(() => optEnum(null, '公开范围', values))).toBe('公开范围需要是 public / unlisted / private 之一');
  });
});

describe('optBool', () => {
  it('passes booleans and undefined through', () => {
    expect(optBool(true, 'x')).toBe(true);
    expect(optBool(false, 'x')).toBe(false);
    expect(optBool(undefined, 'x')).toBeUndefined();
  });

  it('rejects truthy and falsy stand-ins', () => {
    for (const bad of ['true', 'false', 1, 0, null, {}]) {
      expect(
        invalidMessage(() => optBool(bad, 'inLiving')),
        show(bad)
      ).toBe('inLiving需要是 true 或 false');
    }
  });
});

describe('strArray', () => {
  it('gives an empty list for undefined and null', () => {
    expect(strArray(undefined, '标签', 5)).toEqual([]);
    expect(strArray(null, '标签', 5)).toEqual([]);
    expect(strArray([], '标签', 5)).toEqual([]);
  });

  it('keeps strings in order and drops repeats', () => {
    expect(strArray(['b', 'a', 'b', 'c', 'a'], '标签', 10)).toEqual(['b', 'a', 'c']);
  });

  it('allows at most maxItems entries', () => {
    expect(strArray(['a', 'b', 'c'], '标签', 3)).toEqual(['a', 'b', 'c']);
    expect(invalidMessage(() => strArray(['a', 'b', 'c', 'd'], '标签', 3))).toBe('标签最多 3 项');
  });

  it('rejects non-arrays and bad items', () => {
    expect(invalidMessage(() => strArray('a', '标签', 5))).toBe('标签需要是数组');
    expect(invalidMessage(() => strArray({ 0: 'a' }, '标签', 5))).toBe('标签需要是数组');
    expect(invalidMessage(() => strArray(['a', 2], '标签', 5))).toBe('标签里有无效的值');
    expect(invalidMessage(() => strArray(['a', null], '标签', 5))).toBe('标签里有无效的值');
    expect(invalidMessage(() => strArray(['a', ''], '标签', 5))).toBe('标签里有无效的值');
  });

  it('limits each item to maxLen characters, 64 by default', () => {
    expect(strArray(['x'.repeat(64)], '标签', 5)).toEqual(['x'.repeat(64)]);
    expect(invalidMessage(() => strArray(['x'.repeat(65)], '标签', 5))).toBe('标签里有无效的值');
    expect(invalidMessage(() => strArray(['abcd'], '标签', 5, 3))).toBe('标签里有无效的值');
    expect(strArray(['abc'], '标签', 5, 3)).toEqual(['abc']);
  });
});

describe('isDate / optDate', () => {
  it('accepts real calendar dates', () => {
    expect(isDate('2026-11-08')).toBe(true);
    expect(isDate('2024-02-29')).toBe(true);
    expect(isDate('2000-02-29')).toBe(true);
    expect(isDate('2026-12-31')).toBe(true);
  });

  it('rejects dates that do not exist', () => {
    expect(isDate('2026-02-29')).toBe(false);
    expect(isDate('1900-02-29')).toBe(false);
    expect(isDate('2026-04-31')).toBe(false);
    expect(isDate('2026-13-01')).toBe(false);
    expect(isDate('2026-00-10')).toBe(false);
    expect(isDate('2026-11-00')).toBe(false);
    expect(isDate('2026-11-32')).toBe(false);
  });

  it('rejects other shapes', () => {
    for (const bad of [
      '',
      '2026-1-1',
      '26-11-08',
      '2026/11/08',
      '20261108',
      '2026-11-08T00:00:00',
      ' 2026-11-08',
      '2026-11-08 ',
      'today'
    ]) {
      expect(isDate(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it('optDate returns valid dates and null for absent ones', () => {
    expect(optDate('2026-11-08', '开始日期')).toBe('2026-11-08');
    expect(optDate(null, '开始日期')).toBeNull();
    expect(optDate(undefined, '开始日期')).toBeNull();
    expect(optDate('', '开始日期')).toBeNull();
  });

  it('optDate rejects bad values with the expected format in the message', () => {
    expect(invalidMessage(() => optDate('2026-02-30', '开始日期'))).toBe('开始日期格式应为 YYYY-MM-DD');
    expect(invalidMessage(() => optDate('08/11/2026', '开始日期'))).toBe('开始日期格式应为 YYYY-MM-DD');
    expect(invalidMessage(() => optDate(20261108, '开始日期'))).toBe('开始日期格式应为 YYYY-MM-DD');
  });
});

describe('optTakenAt', () => {
  const FORMAT_MESSAGE = '拍摄时间格式应为 YYYY-MM-DDTHH:mm:ss';

  it('returns a full local time unchanged', () => {
    expect(optTakenAt('2026-11-08T14:05:09')).toBe('2026-11-08T14:05:09');
    expect(optTakenAt('2026-11-08T00:00:00')).toBe('2026-11-08T00:00:00');
    expect(optTakenAt('2026-11-08T23:59:59')).toBe('2026-11-08T23:59:59');
  });

  it('fills in missing seconds and drops fractions', () => {
    expect(optTakenAt('2026-11-08T14:05')).toBe('2026-11-08T14:05:00');
    expect(optTakenAt('2026-11-08T14:05:09.123')).toBe('2026-11-08T14:05:09');
  });

  it('keeps the wall-clock time and drops a zone suffix rather than converting it', () => {
    expect(optTakenAt('2026-11-08T14:05:09Z')).toBe('2026-11-08T14:05:09');
    expect(optTakenAt('2026-11-08T14:05:09+08:00')).toBe('2026-11-08T14:05:09');
    expect(optTakenAt('2026-11-08T14:05:09-0530')).toBe('2026-11-08T14:05:09');
    expect(optTakenAt('2026-11-08T14:05:09.250+08:00')).toBe('2026-11-08T14:05:09');
  });

  it('trims surrounding whitespace', () => {
    expect(optTakenAt('  2026-11-08T14:05:09 ')).toBe('2026-11-08T14:05:09');
  });

  it('treats null, undefined and an empty string as absent', () => {
    expect(optTakenAt(null)).toBeNull();
    expect(optTakenAt(undefined)).toBeNull();
    expect(optTakenAt('')).toBeNull();
  });

  it('rejects impossible times and dates', () => {
    for (const bad of [
      '2026-11-08T24:00:00',
      '2026-11-08T14:60:00',
      '2026-11-08T14:05:60',
      '2026-02-30T10:00:00',
      '2026-13-01T10:00:00',
      '2026-11-08T9:05:00'
    ]) {
      expect(
        invalidMessage(() => optTakenAt(bad)),
        bad
      ).toBe(FORMAT_MESSAGE);
    }
  });

  it('rejects other shapes and types', () => {
    for (const bad of ['2026-11-08', '2026-11-08 14:05:09', '14:05:09', 'yesterday', 'garbage', 20261108, true, {}]) {
      expect(
        invalidMessage(() => optTakenAt(bad)),
        show(bad)
      ).toBe(FORMAT_MESSAGE);
    }
  });
});

describe('optTz', () => {
  it('accepts a UTC offset in the usual spellings', () => {
    for (const ok of ['Z', '+08:00', '-05:30', '+0800', '-0530', '+08', '+00:00']) expect(optTz(ok), ok).toBe(ok);
    expect(optTz('  +08:00 ')).toBe('+08:00');
  });

  it('treats null, undefined and an empty string as absent', () => {
    expect(optTz(null)).toBeNull();
    expect(optTz(undefined)).toBeNull();
    expect(optTz('')).toBeNull();
  });

  it('rejects zone names and loose offsets in strict mode', () => {
    for (const bad of ['UTC+8', 'Asia/Shanghai', '+8:00', '8', '+08:0', '0800', 'z', 800, true]) {
      expect(
        invalidMessage(() => optTz(bad)),
        show(bad)
      ).toBe('时区格式应为 +08:00');
    }
  });

  it('drops them instead when lenient, since the zone is only descriptive', () => {
    for (const bad of ['UTC+8', 'Asia/Shanghai', '+8:00', 800]) expect(optTz(bad, true), show(bad)).toBeNull();
    expect(optTz('+08:00', true)).toBe('+08:00');
  });
});

describe('optColor', () => {
  it('accepts #RRGGBB in either case, and mono', () => {
    expect(optColor('#C0392B')).toBe('#C0392B');
    expect(optColor('#c0392b')).toBe('#c0392b');
    expect(optColor('mono')).toBe('mono');
  });

  it('treats null, undefined and an empty string as absent', () => {
    expect(optColor(null)).toBeNull();
    expect(optColor(undefined)).toBeNull();
    expect(optColor('')).toBeNull();
  });

  it('rejects everything else', () => {
    for (const bad of ['#abc', '#12345', '#1234567', 'C0392B', '#GGGGGG', 'red', 'MONO', 'rgb(0,0,0)', 5, {}]) {
      expect(
        invalidMessage(() => optColor(bad)),
        show(bad)
      ).toBe('颜色需要是 #RRGGBB 或 mono');
    }
    expect(invalidMessage(() => optColor('red', '背景色'))).toBe('背景色需要是 #RRGGBB 或 mono');
  });
});

describe('optPalette', () => {
  it('returns up to five hex colours, most dominant first', () => {
    expect(optPalette(['#112233', '#AABBCC'])).toEqual(['#112233', '#AABBCC']);
    expect(optPalette(['#000001', '#000002', '#000003', '#000004', '#000005', '#000006', '#000007'])).toEqual([
      '#000001',
      '#000002',
      '#000003',
      '#000004',
      '#000005'
    ]);
  });

  it('silently drops entries that are not hex colours', () => {
    expect(optPalette(['#112233', 'red', 5, null, '#abc', '#445566'])).toEqual(['#112233', '#445566']);
  });

  it('gives null when nothing usable is left', () => {
    expect(optPalette(null)).toBeNull();
    expect(optPalette(undefined)).toBeNull();
    expect(optPalette([])).toBeNull();
    expect(optPalette(['red', 7])).toBeNull();
  });

  it('rejects a value that is not an array', () => {
    expect(invalidMessage(() => optPalette('#112233'))).toBe('主色需要是颜色数组');
    expect(invalidMessage(() => optPalette({}))).toBe('主色需要是颜色数组');
  });
});

describe('optFocus', () => {
  it('returns a pair within 0..1 unchanged', () => {
    expect(optFocus([0.25, 0.75])).toEqual([0.25, 0.75]);
    expect(optFocus([0, 1])).toEqual([0, 1]);
  });

  it('clamps float noise at the edges instead of failing the upload', () => {
    expect(optFocus([-0.0000001, 1.0000001])).toEqual([0, 1]);
    expect(optFocus([-5, 5])).toEqual([0, 1]);
  });

  it('treats null and undefined as absent', () => {
    expect(optFocus(null)).toBeNull();
    expect(optFocus(undefined)).toBeNull();
  });

  it('rejects anything but two finite numbers', () => {
    for (const bad of [
      [0.5],
      [0.1, 0.2, 0.3],
      [],
      ['0.5', '0.5'],
      [Number.NaN, 0.5],
      [0.5, Number.POSITIVE_INFINITY],
      [0.5, null],
      'x',
      0.5,
      {}
    ]) {
      expect(
        invalidMessage(() => optFocus(bad)),
        JSON.stringify(bad)
      ).toBe('焦点需要是 [x, y]，取值 0 到 1');
    }
  });
});

describe('optHeading', () => {
  it('keeps headings already in [0, 360)', () => {
    expect(optHeading(0)).toBe(0);
    expect(optHeading(90.5)).toBe(90.5);
    expect(optHeading(359.9)).toBeCloseTo(359.9, 9);
  });

  it('normalises into [0, 360)', () => {
    expect(optHeading(360)).toBe(0);
    expect(optHeading(370)).toBe(10);
    expect(optHeading(720)).toBe(0);
    expect(optHeading(-10)).toBe(350);
    expect(optHeading(-360)).toBe(0);
    expect(optHeading(-90)).toBe(270);
  });

  it('treats null and undefined as absent', () => {
    expect(optHeading(null)).toBeNull();
    expect(optHeading(undefined)).toBeNull();
  });

  it('rejects non-numbers and values beyond -360..720', () => {
    expect(invalidMessage(() => optHeading('90'))).toBe('朝向需要是数字');
    expect(invalidMessage(() => optHeading(Number.NaN))).toBe('朝向需要是数字');
    expect(invalidMessage(() => optHeading(-360.1))).toBe('朝向不能小于 -360');
    expect(invalidMessage(() => optHeading(720.1))).toBe('朝向不能大于 720');
  });
});
