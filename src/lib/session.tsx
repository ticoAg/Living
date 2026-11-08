import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { SessionUser, SiteInfo } from '../../shared/types';
import { api } from './api';

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

  const refresh = useCallback(async () => {
    try {
      const [me, info] = await Promise.all([
        api<{ user: SessionUser | null }>('/api/auth/me'),
        api<SiteInfo>('/api/site')
      ]);
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
    setUser(null);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return <SessionContext.Provider value={{ user, site, loading, refresh, logout }}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);
