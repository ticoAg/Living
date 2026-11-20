import type { SessionUser } from '../shared/types';
import type { Grant } from './lib/shares';

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

/** Per-request memoised lookups: the session (lib/session.ts) and the share links held (lib/shares.ts). */
export interface Variables {
  uid?: Promise<string | null>;
  user?: Promise<SessionUser | null>;
  shares?: Promise<Grant[]>;
}

export type AppEnv = { Bindings: Env; Variables: Variables };
