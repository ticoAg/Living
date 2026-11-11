import { lazy, Suspense, useEffect, useId, useRef } from 'react';
import { useSession } from '../lib/session';

// The sign-in dialog shown when the session has expired under an open page. It sits on top of the page, so whatever
// was typed there stays; after signing in, the user sends it again. A native <dialog> keeps focus inside and
// returns it to where it was on close.

const LoginForm = lazy(() => import('../studio/LoginForm'));

export default function ReLogin() {
  const { user, reauth, closeLogin } = useSession();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (reauth && !d.open) d.showModal();
    else if (!reauth && d.open) d.close();
  }, [reauth]);

  return (
    <dialog ref={ref} className="relogin" aria-labelledby={titleId} onClose={closeLogin}>
      {reauth && (
        <div className="relogin-panel">
          <h2 className="relogin-title" id={titleId}>
            重新登录
          </h2>
          <p className="small muted">登录已过期。页面上填写的内容还在，登录后再提交一次。</p>
          <Suspense fallback={<p className="small muted">加载中</p>}>
            <LoginForm initialHandle={user?.handle} autoFocus onSignedIn={closeLogin} />
          </Suspense>
          <button type="button" className="btn btn-quiet relogin-later" onClick={closeLogin}>
            稍后
          </button>
        </div>
      )}
    </dialog>
  );
}
