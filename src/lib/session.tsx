import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { SessionUser, SiteInfo } from '../../shared/types';
import { api } from './api';
import { invalidate } from './useApi';

interface SessionState {
  user: SessionUser | null;
  site: SiteInfo | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionState>({
  user: null,
  site: null,
  loading: true,
  refresh: async () => {},
  logout: async () => {}
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [site, setSite] = useState<SiteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const userId = useRef<string | null | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      const [me, info] = await Promise.all([
        api<{ user: SessionUser | null }>('/api/auth/me'),
        api<SiteInfo>('/api/site')
      ]);
      // what the API returns depends on who is signed in; drop cached responses when that changes
      const next = me.user?.id ?? null;
      if (userId.current !== undefined && userId.current !== next) invalidate('/api');
      userId.current = next;
      setUser(me.user);
      setSite(info);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    userId.current = null;
    setUser(null);
    invalidate('/api');
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return <SessionContext.Provider value={{ user, site, loading, refresh, logout }}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);
