import { describe, expect, it } from 'vite-plus/test';
import { shortCity, shortCounty, shortProvince } from './regions';

describe('shortProvince', () => {
  it('drops the kind of division', () => {
    expect(shortProvince('浙江省')).toBe('浙江');
    expect(shortProvince('北京市')).toBe('北京');
    expect(shortProvince('香港特别行政区')).toBe('香港');
  });

  it('drops the people named in an autonomous region', () => {
    expect(shortProvince('广西壮族自治区')).toBe('广西');
    expect(shortProvince('宁夏回族自治区')).toBe('宁夏');
    expect(shortProvince('新疆维吾尔自治区')).toBe('新疆');
    expect(shortProvince('内蒙古自治区')).toBe('内蒙古');
    expect(shortProvince('西藏自治区')).toBe('西藏');
  });

  it('leaves names from elsewhere alone', () => {
    expect(shortProvince('京都府')).toBe('京都府');
    expect(shortProvince('Bavaria')).toBe('Bavaria');
  });
});

describe('shortCity', () => {
  it('drops 市 and 地区', () => {
    expect(shortCity('杭州市')).toBe('杭州');
    expect(shortCity('阿里地区')).toBe('阿里');
  });

  it('names an autonomous prefecture by place and 州', () => {
    expect(shortCity('大理白族自治州')).toBe('大理州');
    expect(shortCity('恩施土家族苗族自治州')).toBe('恩施州');
    expect(shortCity('黔东南苗族侗族自治州')).toBe('黔东南州');
    expect(shortCity('怒江傈僳族自治州')).toBe('怒江州');
    expect(shortCity('伊犁哈萨克自治州')).toBe('伊犁州');
    expect(shortCity('博尔塔拉蒙古自治州')).toBe('博尔塔拉州');
  });

  it('keeps names that would shrink to one character, a 盟, and foreign names', () => {
    expect(shortCity('沙市')).toBe('沙市');
    expect(shortCity('锡林郭勒盟')).toBe('锡林郭勒盟');
    expect(shortCity('Paris')).toBe('Paris');
    expect(shortCity('京都市')).toBe('京都');
  });
});

describe('shortCounty', () => {
  it('keeps the suffix of an ordinary district or county', () => {
    expect(shortCounty('西湖区')).toBe('西湖区');
    expect(shortCounty('淳安县')).toBe('淳安县');
  });

  it('shrinks an autonomous county or banner to place and suffix', () => {
    expect(shortCounty('长阳土家族自治县')).toBe('长阳县');
    expect(shortCounty('陵水黎族自治县')).toBe('陵水县');
    expect(shortCounty('莫力达瓦达斡尔族自治旗')).toBe('莫力达瓦旗');
  });

  it('keeps it whole when no place name would be left', () => {
    expect(shortCounty('鄂温克族自治旗')).toBe('鄂温克族自治旗');
  });
});
