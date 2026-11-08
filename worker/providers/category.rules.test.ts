import { describe, expect, it } from 'vite-plus/test';
import { categoryFromAmap } from './category';

// AMap's `type` is "大类;中类;小类", and the rules are plain substring matches, so a rule for a small category
// has to come before any rule that matches the name of its parent level.

describe('categoryFromAmap: specific categories before their parent levels', () => {
  describe('城市广场 sits under 公园广场', () => {
    it('files a city square under 街区, not as a park', () => {
      expect(categoryFromAmap('风景名胜;公园广场;城市广场', '武林广场')).toBe('街区');
      expect(categoryFromAmap('风景名胜;公园广场;城市广场', '某处')).toBe('街区');
    });

    it('still files the parks next to it as parks', () => {
      expect(categoryFromAmap('风景名胜;公园广场;公园', '太子湾公园')).toBe('园');
      expect(categoryFromAmap('风景名胜;公园广场;动物园', '杭州动物园')).toBe('园');
      expect(categoryFromAmap('风景名胜;公园广场;植物园', '杭州植物园')).toBe('园');
    });

    it('still lets a name suffix refine a square', () => {
      expect(categoryFromAmap('风景名胜;公园广场;城市广场', '湖滨音乐喷泉亭')).toBe('亭');
    });
  });

  describe('village-level names sit under 普通地名', () => {
    it('files a village under 村 whatever its name ends in', () => {
      expect(categoryFromAmap('地名地址信息;普通地名;村庄级地名', '梅家坞')).toBe('村');
      expect(categoryFromAmap('地名地址信息;普通地名;村组级地名', '某某组')).toBe('村');
      expect(categoryFromAmap('地名地址信息;普通地名;自然村', '某某坞')).toBe('村');
    });

    it('still files the other place names under 街区', () => {
      expect(categoryFromAmap('地名地址信息;普通地名;区县级地名', '西湖区')).toBe('街区');
      expect(categoryFromAmap('地名地址信息;普通地名;乡镇级地名', '某某镇')).toBe('街区');
      expect(categoryFromAmap('地名地址信息;普通地名;街道级地名', '北山街道')).toBe('街区');
      expect(categoryFromAmap('地名地址信息;行政地名;区县级地名', '上城区')).toBe('街区');
      expect(categoryFromAmap('地名地址信息;普通地名', '某处')).toBe('街区');
    });

    it('still lets a name suffix refine a village', () => {
      expect(categoryFromAmap('地名地址信息;普通地名;村庄级地名', '龙井村')).toBe('村');
      expect(categoryFromAmap('地名地址信息;普通地名;村庄级地名', '某某山')).toBe('山');
    });
  });
});
