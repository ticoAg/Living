import { MY_SHARES, useShares } from '../../shares/api';
import ShareItem from '../../shares/ShareItem';
import { useKeep } from '../util';
import '../../styles/shares.css';

/** Every share link one has made, newest first, to copy or delete; each item's own dialog makes new ones. */
export default function SharesSection() {
  const req = useShares(MY_SHARES);
  const shares = useKeep(req.shares);

  return (
    <section className="se-section sf-panel" id="shares" aria-labelledby="se-shares-h">
      <h2 className="sf-h" id="se-shares-h">
        分享链接
      </h2>
      <p className="muted se-lede">
        一个链接打开一条记录、一个合集或一个项目，拿到的人不用登录就能看，包括其中仅自己可见的内容。删掉立刻失效。新建在各自页面的「分享」里。
      </p>
      {!shares && !req.error && <p className="small muted">加载中…</p>}
      {req.error != null && !shares && (
        <p className="error-text">
          分享链接加载失败。
          <button type="button" className="btn btn-quiet" onClick={req.reload}>
            重试
          </button>
        </p>
      )}
      {shares && shares.length === 0 && <p className="small muted">还没有分享链接。</p>}
      {shares && shares.length > 0 && (
        <ul className="sh-list">
          {shares.map((s) => (
            <ShareItem key={s.id} share={s} withTarget />
          ))}
        </ul>
      )}
    </section>
  );
}
