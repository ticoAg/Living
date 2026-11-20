import { useEffect, useState } from 'react';
import { useLocation, useParams } from 'wouter';
import type { OpenShareResponse } from '../../shared/types';
import { LoadError, Loading } from '../browse/ui';
import { api } from '../lib/api';
import { forget } from '../lib/useApi';
import { targetPath, targetReads } from '../shares/api';
import { useDocumentTitle } from '../themes/hooks';
import '../styles/browse.css';

// /s/:token — a share link. Opening it hands this browser the link (a cookie the server sets), then the shared item
// opens at its usual address, now readable here. Docs: /docs/product/features/sharing.md, /docs/api/shares.md

export default function ShareOpen() {
  const { token } = useParams<{ token: string }>();
  const [, navigate] = useLocation();
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  useDocumentTitle(error ? '链接不存在或已失效' : '打开分享');

  useEffect(() => {
    let live = true;
    setError(null);
    api<OpenShareResponse>('/api/shares/open', { json: { token } })
      .then(({ kind, id }) => {
        if (!live) return;
        // what this tab read of the item before it held the link is not what it may read now
        targetReads(kind, id).forEach(forget);
        navigate(targetPath(kind, id), { replace: true });
      })
      .catch((e: unknown) => live && setError(e));
    return () => {
      live = false;
    };
  }, [token, attempt, navigate]);

  return (
    <main className="page-narrow">
      {error ? (
        <LoadError
          error={error}
          onRetry={() => setAttempt((n) => n + 1)}
          notFound={{ title: '链接不存在或已失效', hint: '作者可能已经删除了它，或者它已过期。', back: { href: '/', label: '去首页' } }}
        />
      ) : (
        <Loading />
      )}
    </main>
  );
}
