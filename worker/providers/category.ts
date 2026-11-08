// Maps provider data (AMap type strings, OSM tags) and place names to POI_CATEGORIES.
// docs/product/features/poi-matching.md

import { CATEGORY_RADIUS } from '../../shared/geo';
import type { PoiCategory } from '../../shared/types';

/** Categories whose places are areas: a photo inside counts as "at" the place (distance 0, `area: true`). */
const AREA_CATEGORIES: ReadonlySet<string> = new Set(['湖', '园', '岛', '村', '街区', '海岸', '山']);
export const isAreaCategory = (category: string): boolean => AREA_CATEGORIES.has(category);

export const radiusOf = (category: string): number => CATEGORY_RADIUS[category] ?? 120;

const SUFFIX_CATEGORY: Record<string, PoiCategory> = {
  桥: '桥',
  湖: '湖',
  山: '山',
  寺: '寺',
  塔: '塔',
  岛: '岛',
  村: '村',
  园: '园',
  亭: '亭',
  堤: '堤'
};

/** Name-suffix override (桥 湖 山 寺 塔 岛 村 园 亭 堤). Shops keep their category: "XX园" the restaurant is not a park. */
export function applySuffix(category: PoiCategory, name: string): PoiCategory {
  if (category === '店') return category;
  const last = [...name.trim()].pop();
  return (last && SUFFIX_CATEGORY[last]) || category;
}

/** Substring rules, first match wins. Applied to AMap's `type` ("风景名胜;公园广场;公园"). */
const AMAP_RULES: [RegExp, PoiCategory][] = [
  [/桥/, '桥'],
  [/寺庙|道观|教堂|清真寺|宗教|佛教|道教|基督教|伊斯兰/, '寺'],
  [/塔/, '塔'],
  [/岛/, '岛'],
  [/湖|水库|河流|水系/, '湖'],
  [/山/, '山'],
  [/海滩|海岸|海湾|海滨|沙滩|岬/, '海岸'],
  [/动物园|植物园|公园|花园|园林|游乐园|主题乐园/, '园'],
  [/城市广场|广场|步行街|商业街|古镇|老街|历史街区/, '街区'],
  [/博物馆|美术馆|展览馆|画廊|艺术|科技馆|纪念馆|天文馆|文化宫|图书馆|剧院|音乐厅/, '美术馆'],
  [/区县级地名|乡镇级地名|街道级地名|行政地名|地名地址信息;普通地名/, '街区'],
  [/村庄级地名|村组级地名|自然村/, '村'],
  [/道路名|道路|路口|街巷/, '道路'],
  [/咖啡|茶艺|茶馆|餐饮|中餐|西餐|小吃|购物|商场|特色商业街/, '店'],
  [/建筑|大厦|标志/, '建筑'],
  [/风景名胜|旅游景点|文物古迹|古迹|名胜/, '景']
];

/** Types we never want as photo places (the AMap query is broad: addresses, schools, housing…). */
const AMAP_DROP = /门牌|楼栋|住宅|小区|宿舍|学校|幼儿园|培训|政府|公司|企业|医院|诊所|银行|停车|加油|公交|地铁|收费|厕所|生活服务|汽车/;

export function categoryFromAmap(type: string, name: string): PoiCategory | null {
  if (!name) return null;
  if (AMAP_DROP.test(type) && !/风景名胜|博物馆|美术馆|寺|公园/.test(type)) return null;
  for (const [re, category] of AMAP_RULES) if (re.test(type)) return applySuffix(category, name);
  return applySuffix('景', name);
}

type Tags = Record<string, string | undefined>;

/** OSM tags → category, or null for features that are not photo places (for example a road that merely crosses a bridge). */
export function categoryFromOsm(tags: Tags, name: string): PoiCategory | null {
  if (!name) return null;
  const { man_made: manMade, natural, leisure, tourism, historic, amenity, place, bridge, highway, railway } = tags;

  let c: PoiCategory | null = null;
  if (manMade === 'bridge') c = '桥';
  else if (bridge && bridge !== 'no' && (highway || railway || !manMade)) {
    // A road or rail way tagged bridge=*: only a real bridge when the name says so.
    if (!/桥|橋|bridge/i.test(name)) return null;
    c = '桥';
  } else if (manMade === 'tower') c = '塔';
  else if (manMade === 'pier') c = '堤';
  else if (natural) {
    if (['water', 'wetland', 'lake', 'reservoir'].includes(natural)) c = '湖';
    else if (['peak', 'hill', 'volcano', 'ridge', 'cliff', 'rock'].includes(natural)) c = '山';
    else if (['beach', 'coastline', 'cape', 'bay', 'strait'].includes(natural)) c = '海岸';
    else if (['island', 'islet'].includes(natural)) c = '岛';
    else c = '景';
  } else if (leisure === 'park' || leisure === 'garden') c = '园';
  else if (amenity === 'place_of_worship') c = '寺';
  else if (amenity === 'cafe' || amenity === 'restaurant') c = '店';
  else if (amenity === 'arts_centre') c = '美术馆';
  else if (amenity === 'library' || amenity === 'theatre') c = '建筑';
  else if (tourism === 'museum' || tourism === 'gallery') c = '美术馆';
  else if (
    tourism === 'attraction' ||
    tourism === 'viewpoint' ||
    tourism === 'artwork' ||
    tourism === 'zoo' ||
    tourism === 'theme_park' ||
    tourism === 'aquarium'
  )
    c = '景';
  else if (historic) c = '景';
  else if (place === 'island' || place === 'islet') c = '岛';
  else if (place === 'village' || place === 'hamlet') c = '村';
  else if (place === 'square' || place === 'neighbourhood' || place === 'quarter') c = '街区';
  else if (tourism) c = '景';
  if (!c) return null;
  return applySuffix(c, name);
}
