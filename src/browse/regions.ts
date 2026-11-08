// Short forms of administrative names for map labels: 广西壮族自治区 → 广西, 杭州市 → 杭州, 大理白族自治州 → 大理州.
// The full names stay in the side panel. Names from outside China pass through unchanged.

/** The 55 minorities, as they appear in the names of autonomous areas. */
const ETHNIC =
  '蒙古|回|藏|维吾尔|苗|彝|壮|布依|朝鲜|满|侗|瑶|白|土家|哈尼|哈萨克|傣|黎|傈僳|佤|畲|高山|拉祜|水|东乡|纳西|景颇|柯尔克孜|土|达斡尔|仫佬|羌|布朗|撒拉|毛南|仡佬|锡伯|阿昌|普米|塔吉克|怒|乌孜别克|俄罗斯|鄂温克|德昂|保安|裕固|京|塔塔尔|独龙|鄂伦春|赫哲|门巴|珞巴|基诺';
// 族 is required, or 陵水黎族自治县 would be read as 陵 + 水黎族; only 哈萨克, 蒙古 and 柯尔克孜 appear without it
// (伊犁哈萨克自治州, 博尔塔拉蒙古自治州, 克孜勒苏柯尔克孜自治州).
const AUTONOMOUS = new RegExp(`(?:(?:${ETHNIC})族|哈萨克|蒙古|柯尔克孜)+自治(州|县|旗)$`);

/** 自治州/县/旗 → 州/县/旗 after the place name, when a place name of two characters or more is left. */
function autonomous(name: string): string | null {
  const m = AUTONOMOUS.exec(name);
  if (!m) return null;
  const head = name.slice(0, m.index);
  return [...head].length >= 2 ? head + m[1] : null;
}

const PROVINCE_SUFFIX = /(?:省|市|特别行政区|壮族自治区|回族自治区|维吾尔自治区|自治区)$/;

/** 浙江省 → 浙江, 北京市 → 北京, 广西壮族自治区 → 广西, 香港特别行政区 → 香港 */
export function shortProvince(name: string): string {
  const short = name.replace(PROVINCE_SUFFIX, '');
  return [...short].length >= 2 ? short : name;
}

/** 杭州市 → 杭州, 大理白族自治州 → 大理州, 阿里地区 → 阿里; 锡林郭勒盟 and single-character results stay as they are */
export function shortCity(name: string): string {
  const auto = autonomous(name);
  if (auto) return auto;
  const short = name.replace(/(?:市|地区)$/, '');
  return [...short].length >= 2 ? short : name;
}

/** Districts and counties keep their suffix (西湖区 is not the lake); autonomous ones shrink: 长阳土家族自治县 → 长阳县 */
export function shortCounty(name: string): string {
  return autonomous(name) ?? name;
}
