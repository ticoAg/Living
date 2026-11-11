import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { SessionUser, SiteInfo } from '../../shared/types';
import { api, onSessionLost } from './api';
import { invalidate } from './useApi';

interface SessionState {
  /** The signed-in account. While `expired`, still the account that was signed in, so open pages keep their forms. */
  user: SessionUser | null;
  site: SiteInfo | null;
  loading: boolean;
  /** The server no longer knows this session (30 days passed, or signed out elsewhere); the header shows 登录. */
  expired: boolean;
  /** The sign-in dialog is open (components/ReLogin.tsx). */
  reauth: boolean;
  /** Open the sign-in dialog on top of the current page. */
  askLogin: () => void;
  closeLogin: () => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const noop = () => {};
const SessionContext = createContext<SessionState>({
  user: null,
  site: null,
  loading: true,
  expired: false,
  reauth: false,
  askLogin: noop,
  closeLogin: noop,
  refresh: async () => {},
  logout: async () => {}
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [site, setSite] = useState<SiteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [expired, setExpired] = useState(false);
  const [reauth, setReauth] = useState(false);
  const userId = useRef<string | null | undefined>(undefined);
  const expiredRef = useRef(false);

  const markExpired = useCallback((value: boolean) => {
    expiredRef.current = value;
    setExpired(value);
    setReauth(value);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [me, info] = await Promise.all([api<{ user: SessionUser | null }>('/api/auth/me'), api<SiteInfo>('/api/site')]);
      // what the API returns depends on who is signed in; drop cached responses when that changes
      const next = me.user?.id ?? null;
      if (userId.current !== undefined && userId.current !== next) invalidate('/api');
      userId.current = next;
      setUser(me.user);
      setSite(info);
      markExpired(false);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [markExpired]);

  const logout = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    userId.current = null;
    setUser(null);
    markExpired(false);
    invalidate('/api');
  }, [markExpired]);

  // A request was refused for lack of a session. A guest's 401 is the page's business; for a signed-in user, confirm
  // with the server, then ask for the password again on top of the page, so nothing typed there is lost.
  useEffect(() => {
    let checking = false;
    return onSessionLost(() => {
      if (!userId.current) return;
      if (expiredRef.current) {
        setReauth(true);
        return;
      }
      if (checking) return;
      checking = true;
      api<{ user: SessionUser | null }>('/api/auth/me')
        .then((me) => {
          if (!me.user) markExpired(true);
        })
        .catch(() => {})
        .finally(() => (checking = false));
    });
  }, [markExpired]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const askLogin = useCallback(() => setReauth(true), []);
  const closeLogin = useCallback(() => setReauth(false), []);

  return (
    <SessionContext.Provider value={{ user, site, loading, expired, reauth, askLogin, closeLogin, refresh, logout }}>
      {children}
    </SessionContext.Provider>
  );
}

export const useSession = () => useContext(SessionContext);
