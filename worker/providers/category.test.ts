import { describe, expect, it } from 'vite-plus/test';
import { CATEGORY_RADIUS } from '../../shared/geo';
import { POI_CATEGORIES } from '../../shared/types';
import { applySuffix, categoryFromAmap, categoryFromOsm, isAreaCategory, radiusOf } from './category';

describe('isAreaCategory', () => {
  it('is true for the categories whose places are areas', () => {
    for (const category of ['湖', '园', '岛', '村', '街区', '海岸', '山']) expect(isAreaCategory(category), category).toBe(true);
  });

  it('is false for point-like places and unknown names', () => {
    for (const category of ['桥', '堤', '塔', '寺', '亭', '景', '建筑', '美术馆', '店', '道路', '', '未知']) {
      expect(isAreaCategory(category), category).toBe(false);
    }
  });

  it('only names real categories', () => {
    for (const category of ['湖', '园', '岛', '村', '街区', '海岸', '山']) expect(POI_CATEGORIES as readonly string[]).toContain(category);
  });
});

describe('radiusOf', () => {
  it('gives the matching radius of each category', () => {
    expect(radiusOf('桥')).toBe(60);
    expect(radiusOf('寺')).toBe(150);
    expect(radiusOf('山')).toBe(400);
    expect(radiusOf('湖')).toBe(600);
    expect(radiusOf('店')).toBe(30);
  });

  it('knows every category and agrees with CATEGORY_RADIUS', () => {
    for (const category of POI_CATEGORIES) expect(radiusOf(category), category).toBe(CATEGORY_RADIUS[category]);
  });

  it('falls back to 120 m for anything else', () => {
    expect(radiusOf('未知')).toBe(120);
    expect(radiusOf('')).toBe(120);
  });
});

describe('applySuffix', () => {
  it('lets the last character of the name override the category', () => {
    expect(applySuffix('景', '断桥')).toBe('桥');
    expect(applySuffix('景', '雷峰塔')).toBe('塔');
    expect(applySuffix('景', '灵隐寺')).toBe('寺');
    expect(applySuffix('景', '三潭印月岛')).toBe('岛');
    expect(applySuffix('景', '梅家坞村')).toBe('村');
    expect(applySuffix('景', '湖心亭')).toBe('亭');
    expect(applySuffix('景', '苏堤')).toBe('堤');
    expect(applySuffix('景', '宝石山')).toBe('山');
    expect(applySuffix('景', '太子湾公园')).toBe('园');
    expect(applySuffix('街区', '赤山湖')).toBe('湖');
  });

  it('only looks at the end of the name', () => {
    expect(applySuffix('景', '桥西历史街区')).toBe('景');
    expect(applySuffix('景', '西湖景区')).toBe('景');
    expect(applySuffix('湖', '北山街')).toBe('湖');
  });

  it('ignores surrounding whitespace', () => {
    expect(applySuffix('景', '  断桥 ')).toBe('桥');
  });

  it('keeps the category when the name is empty or has no such ending', () => {
    expect(applySuffix('景', '')).toBe('景');
    expect(applySuffix('景', '   ')).toBe('景');
    expect(applySuffix('美术馆', '浙江省博物馆')).toBe('美术馆');
  });

  it('never turns a shop into something else: "XX园" the restaurant is not a park', () => {
    expect(applySuffix('店', '某某园')).toBe('店');
    expect(applySuffix('店', '湖畔居茶楼桥')).toBe('店');
  });
});

describe('categoryFromAmap', () => {
  it('has no category for a place without a name', () => {
    expect(categoryFromAmap('风景名胜;公园广场;公园', '')).toBeNull();
  });

  it('maps the AMap type text to a category', () => {
    const cases: [string, string][] = [
      ['风景名胜;公园广场;公园', '园'],
      ['风景名胜;风景名胜;寺庙道观', '寺'],
      ['风景名胜;风景名胜;教堂', '寺'],
      ['风景名胜;风景名胜;桥', '桥'],
      ['风景名胜;风景名胜;塔', '塔'],
      ['风景名胜;风景名胜;岛屿', '岛'],
      ['地名地址信息;自然地名;湖泊', '湖'],
      ['风景名胜;风景名胜;水库', '湖'],
      ['地名地址信息;自然地名;山', '山'],
      ['风景名胜;风景名胜;海滨浴场', '海岸'],
      ['风景名胜;风景名胜;沙滩', '海岸'],
      ['风景名胜;公园广场;动物园', '园'],
      ['风景名胜;风景名胜;古镇', '街区'],
      ['风景名胜;风景名胜;步行街', '街区'],
      ['科教文化服务;博物馆;博物馆', '美术馆'],
      ['科教文化服务;美术馆;美术馆', '美术馆'],
      ['科教文化服务;图书馆;图书馆', '美术馆'],
      ['地名地址信息;交通地名;道路名', '道路'],
      ['餐饮服务;咖啡厅;咖啡厅', '店'],
      ['购物服务;商场;购物中心', '店'],
      ['地名地址信息;标志性建筑物;标志性建筑物', '建筑'],
      ['风景名胜;风景名胜;国家级景点', '景'],
      ['风景名胜;风景名胜;文物古迹', '景']
    ];
    for (const [type, expected] of cases) expect(categoryFromAmap(type, '某处'), type).toBe(expected);
  });

  it('uses the first rule that matches when a type names several things', () => {
    // 桥 comes before 公园, 寺 before 山
    expect(categoryFromAmap('风景名胜;公园广场;公园内桥', '某处')).toBe('桥');
    expect(categoryFromAmap('风景名胜;风景名胜;寺庙道观;山', '某处')).toBe('寺');
  });

  it('falls back to 景 for an unfamiliar or empty type', () => {
    expect(categoryFromAmap('完全陌生的类型', '某处')).toBe('景');
    expect(categoryFromAmap('', '某处')).toBe('景');
  });

  it('lets the name suffix refine the category, as the API documentation says', () => {
    expect(categoryFromAmap('风景名胜;风景名胜;国家级景点', '西湖')).toBe('湖');
    expect(categoryFromAmap('风景名胜;风景名胜;国家级景点', '断桥')).toBe('桥');
    expect(categoryFromAmap('风景名胜;风景名胜;国家级景点', '孤山')).toBe('山');
    expect(categoryFromAmap('地名地址信息;普通地名;村庄级地名', '龙井村')).toBe('村');
    expect(categoryFromAmap('科教文化服务;博物馆;博物馆', '浙江省博物馆')).toBe('美术馆');
  });

  it('keeps shops as shops whatever their name ends in', () => {
    expect(categoryFromAmap('餐饮服务;咖啡厅;咖啡厅', '湖畔园')).toBe('店');
    expect(categoryFromAmap('购物服务;商场;购物中心', '西湖天地桥')).toBe('店');
  });

  describe('places that are not photo places', () => {
    it('drops addresses, housing, schools, offices and services', () => {
      const dropped = [
        '地名地址信息;门牌信息;门牌号',
        '商务住宅;住宅区;住宅小区',
        '商务住宅;楼宇;商务写字楼',
        '科教文化服务;学校;高等院校',
        '科教文化服务;学校;幼儿园',
        '政府机构及社会团体;政府机关;区县级政府及事业单位',
        '公司企业;公司;公司',
        '医疗保健服务;综合医院;三甲医院',
        '金融保险服务;银行;中国工商银行',
        '交通设施服务;停车场;停车场入口',
        '交通设施服务;公交车站;公交车站相关',
        '交通设施服务;地铁站;地铁站',
        '生活服务;公共厕所;公共厕所',
        '汽车服务;加油站;中国石化'
      ];
      for (const type of dropped) expect(categoryFromAmap(type, '某处'), type).toBeNull();
    });

    it('keeps such a type when it also names a sight, museum, temple or park', () => {
      expect(categoryFromAmap('科教文化服务;学校;美术馆', '某处')).toBe('美术馆');
      expect(categoryFromAmap('政府机构及社会团体;政府机关;风景名胜', '某处')).toBe('景');
      expect(categoryFromAmap('商务住宅;住宅区;公园', '某处')).toBe('园');
      expect(categoryFromAmap('公司企业;公司;寺庙', '某处')).toBe('寺');
      expect(categoryFromAmap('科教文化服务;学校;博物馆', '某处')).toBe('美术馆');
    });
  });
});

describe('categoryFromOsm', () => {
  const tagged = (tags: Record<string, string>, name = '某处') => categoryFromOsm(tags, name);

  it('has no category for a place without a name', () => {
    expect(categoryFromOsm({ natural: 'water' }, '')).toBeNull();
  });

  it('has no category for a feature that is not a photo place', () => {
    expect(tagged({})).toBeNull();
    expect(tagged({ highway: 'residential' })).toBeNull();
    expect(tagged({ building: 'yes' })).toBeNull();
    expect(tagged({ amenity: 'bench' })).toBeNull();
  });

  it('maps man-made structures', () => {
    expect(tagged({ man_made: 'bridge' })).toBe('桥');
    expect(tagged({ man_made: 'tower' })).toBe('塔');
    expect(tagged({ man_made: 'pier' })).toBe('堤');
  });

  it('maps natural features', () => {
    for (const natural of ['water', 'wetland', 'lake', 'reservoir']) expect(tagged({ natural }), natural).toBe('湖');
    for (const natural of ['peak', 'hill', 'volcano', 'ridge', 'cliff', 'rock']) expect(tagged({ natural }), natural).toBe('山');
    for (const natural of ['beach', 'coastline', 'cape', 'bay', 'strait']) expect(tagged({ natural }), natural).toBe('海岸');
    for (const natural of ['island', 'islet']) expect(tagged({ natural }), natural).toBe('岛');
    expect(tagged({ natural: 'tree' })).toBe('景');
  });

  it('maps parks, worship, food, art and culture', () => {
    expect(tagged({ leisure: 'park' })).toBe('园');
    expect(tagged({ leisure: 'garden' })).toBe('园');
    expect(tagged({ amenity: 'place_of_worship' })).toBe('寺');
    expect(tagged({ amenity: 'cafe' })).toBe('店');
    expect(tagged({ amenity: 'restaurant' })).toBe('店');
    expect(tagged({ amenity: 'arts_centre' })).toBe('美术馆');
    expect(tagged({ amenity: 'library' })).toBe('建筑');
    expect(tagged({ amenity: 'theatre' })).toBe('建筑');
    expect(tagged({ tourism: 'museum' })).toBe('美术馆');
    expect(tagged({ tourism: 'gallery' })).toBe('美术馆');
  });

  it('maps tourism, history and settlements', () => {
    for (const tourism of ['attraction', 'viewpoint', 'artwork', 'zoo', 'theme_park', 'aquarium', 'something_else']) {
      expect(tagged({ tourism }), tourism).toBe('景');
    }
    expect(tagged({ historic: 'monument' })).toBe('景');
    expect(tagged({ place: 'island' })).toBe('岛');
    expect(tagged({ place: 'islet' })).toBe('岛');
    expect(tagged({ place: 'village' })).toBe('村');
    expect(tagged({ place: 'hamlet' })).toBe('村');
    for (const place of ['square', 'neighbourhood', 'quarter']) expect(tagged({ place }), place).toBe('街区');
  });

  it('prefers the more specific tag when a feature has several', () => {
    expect(tagged({ natural: 'water', tourism: 'attraction' })).toBe('湖');
    expect(tagged({ leisure: 'park', tourism: 'attraction' })).toBe('园');
    expect(tagged({ tourism: 'museum', historic: 'building' })).toBe('美术馆');
    expect(tagged({ man_made: 'tower', tourism: 'attraction' })).toBe('塔');
  });

  describe('bridges', () => {
    it('always counts a man_made bridge, whatever it is called', () => {
      expect(categoryFromOsm({ man_made: 'bridge' }, '某某通道')).toBe('桥');
      expect(categoryFromOsm({ man_made: 'bridge' }, 'Unnamed crossing')).toBe('桥');
    });

    it('counts a road or railway with bridge=* only when the name says bridge', () => {
      expect(categoryFromOsm({ highway: 'primary', bridge: 'yes' }, '苏堤春晓桥')).toBe('桥');
      expect(categoryFromOsm({ highway: 'primary', bridge: 'yes' }, '长江大橋')).toBe('桥');
      expect(categoryFromOsm({ railway: 'rail', bridge: 'viaduct' }, 'Hangzhou Bay Bridge')).toBe('桥');
      expect(categoryFromOsm({ highway: 'primary', bridge: 'yes' }, '文三路')).toBeNull();
      expect(categoryFromOsm({ railway: 'rail', bridge: 'yes' }, '沪昆线')).toBeNull();
    });

    it('ignores bridge=no', () => {
      expect(categoryFromOsm({ highway: 'primary', bridge: 'no' }, '某桥路')).toBeNull();
    });

    it('does not let a bridge tag override another man_made type', () => {
      expect(categoryFromOsm({ man_made: 'tower', bridge: 'yes' }, '某处')).toBe('塔');
    });
  });

  it('lets the name suffix refine the result, but never turns a shop into something else', () => {
    expect(categoryFromOsm({ tourism: 'attraction' }, '雷峰塔')).toBe('塔');
    expect(categoryFromOsm({ natural: 'water' }, '西湖')).toBe('湖');
    expect(categoryFromOsm({ historic: 'archaeological_site' }, '灵隐寺')).toBe('寺');
    expect(categoryFromOsm({ amenity: 'cafe' }, '某某园')).toBe('店');
    expect(categoryFromOsm({ amenity: 'restaurant' }, '山外山')).toBe('店');
  });
});
