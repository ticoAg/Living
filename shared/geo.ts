// Geodesy helpers shared by the Worker and the SPA. Coordinates are WGS-84 unless a name says GCJ-02.

const R = 6371008.8; // mean Earth radius, metres
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Great-circle distance in metres. */
export function distance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial bearing from point 1 to point 2, degrees clockwise from north (0..360). */
export function bearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const y = Math.sin(rad(lng2 - lng1)) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lng2 - lng1));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Smallest absolute difference between two headings, 0..180. */
export function angleDiff(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

/** Point reached from (lat,lng) after `meters` along `brg` degrees. Returns [lat, lng]. */
export function destination(lat: number, lng: number, brg: number, meters: number): [number, number] {
  const d = meters / R;
  const b = rad(brg);
  const p1 = rad(lat);
  const l1 = rad(lng);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [deg(p2), ((deg(l2) + 540) % 360) - 180];
}

/** GeoJSON ring ([lng, lat][]) approximating a circle. */
export function circleRing(lat: number, lng: number, meters: number, steps = 48): [number, number][] {
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const [la, ln] = destination(lat, lng, (360 * i) / steps, meters);
    ring.push([ln, la]);
  }
  return ring;
}

/** GeoJSON ring ([lng, lat][]) for a camera view cone. */
export function coneRing(lat: number, lng: number, heading: number, meters: number, spread = 28, steps = 12): [number, number][] {
  const ring: [number, number][] = [[lng, lat]];
  for (let i = 0; i <= steps; i++) {
    const [la, ln] = destination(lat, lng, heading - spread + (2 * spread * i) / steps, meters);
    ring.push([ln, la]);
  }
  ring.push([lng, lat]);
  return ring;
}

/** Round a coordinate to roughly 500 m for `fuzzy` location privacy. */
export function fuzz(v: number): number {
  return Math.round(v / 0.005) * 0.005;
}

export function outOfChina(lat: number, lng: number): boolean {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

const A = 6378245.0;
const EE = 0.00669342162296594323;
function tLat(x: number, y: number) {
  let r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  r += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  r += ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3;
  r += ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) * 2) / 3;
  return r;
}
function tLng(x: number, y: number) {
  let r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  r += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  r += ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3;
  r += ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) * 2) / 3;
  return r;
}

/** WGS-84 → GCJ-02 (used by AMap). Returns [lat, lng]. */
export function wgs84ToGcj02(lat: number, lng: number): [number, number] {
  if (outOfChina(lat, lng)) return [lat, lng];
  let dLat = tLat(lng - 105, lat - 35);
  let dLng = tLng(lng - 105, lat - 35);
  const radLat = rad(lat);
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180) / (((A * (1 - EE)) / (magic * sqrtMagic)) * Math.PI);
  dLng = (dLng * 180) / ((A / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return [lat + dLat, lng + dLng];
}

/** GCJ-02 → WGS-84 (iterative inverse, ~1e-6° accuracy). Returns [lat, lng]. */
export function gcj02ToWgs84(lat: number, lng: number): [number, number] {
  if (outOfChina(lat, lng)) return [lat, lng];
  let wLat = lat;
  let wLng = lng;
  for (let i = 0; i < 6; i++) {
    const [gLat, gLng] = wgs84ToGcj02(wLat, wLng);
    wLat -= gLat - lat;
    wLng -= gLng - lng;
  }
  return [wLat, wLng];
}

/** 30°15′33″N style formatting. */
export function dms(v: number, pos: string, neg: string, secDigits = 0): string {
  const h = v >= 0 ? pos : neg;
  const a = Math.abs(v);
  const d = Math.floor(a);
  const mf = (a - d) * 60;
  const m = Math.floor(mf);
  const s = (mf - m) * 60;
  const sTxt = s.toFixed(secDigits).padStart(secDigits ? secDigits + 3 : 2, '0');
  return `${d}°${String(m).padStart(2, '0')}′${sTxt}″${h}`;
}
export const fmtLat = (v: number) => dms(v, 'N', 'S');
export const fmtLng = (v: number) => dms(v, 'E', 'W');

const DIRS = ['北', '北偏东', '东北', '东偏北', '东', '东偏南', '东南', '南偏东', '南', '南偏西', '西南', '西偏南', '西', '西偏北', '西北', '北偏西'];
/** 16-wind Chinese compass name for a heading. */
export function compass(heading: number): string {
  return DIRS[Math.round((((heading % 360) + 360) % 360) / 22.5) % 16];
}

/** "32 m" / "1.2 km" */
export function fmtDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

/** Default matching radius per POI category, metres. */
export const CATEGORY_RADIUS: Record<string, number> = {
  桥: 60, 堤: 150, 湖: 600, 山: 400, 塔: 120, 寺: 150, 亭: 40, 园: 200, 岛: 200, 村: 300,
  景: 120, 街区: 200, 建筑: 60, 美术馆: 80, 海岸: 300, 店: 30, 道路: 40
};
