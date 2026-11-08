/** A place from an external provider, normalised to WGS-84 and POI_CATEGORIES. */
export interface ExternalPlace {
  source: 'amap' | 'osm';
  sourceId: string;
  name: string;
  category: string;
  lat: number;
  lng: number;
  city: string | null;
  district: string | null;
}

export interface Geocode {
  city: string | null;
  district: string | null;
}
