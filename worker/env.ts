import type { SessionUser } from '../shared/types';

export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  KV: KVNamespace;
  ASSETS: Fetcher;
  SITE_NAME: string;
  SITE_URL: string;
  /** AMap web-service key (optional). Without it POI matching uses OpenStreetMap. */
  AMAP_KEY?: string;
}

/** Per-request memoised session lookups (see lib/session.ts). */
export interface Variables {
  uid?: Promise<string | null>;
  user?: Promise<SessionUser | null>;
}

export type AppEnv = { Bindings: Env; Variables: Variables };
