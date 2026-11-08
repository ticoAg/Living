import { Link, useParams } from 'wouter';
import type { ThemeSummary, UserProfile } from '../../shared/types';
import { enc, unwrap, usePhotoList } from '../browse/api';
import Gallery from '../browse/Gallery';
import { useDocTitle, useScrollTop } from '../browse/hooks';
import { LoadError, Loading } from '../browse/ui';
import Img from '../components/Img';
import { useApi } from '../lib/useApi';
import { fmtDay } from '../lib/format';
import '../styles/browse.css';

const VISIBILITY: Record<string, string> = { unlisted: '仅链接可见', private: '仅自己可见' };

function themeMeta(t: ThemeSummary): string {
  const range = t.startDate
    ? `${fmtDay(t.startDate)}${t.endDate && t.endDate !== t.startDate ? ` – ${fmtDay(t.endDate).slice(5)}` : ''}`
    : t.kind === 'trip'
      ? '旅程'
      : '专题';
  return `${range} · ${t.photoCount} 张`;
}

/** /@handle — the user's header, public themes and gallery. */
export default function Profile() {
  // The route is declared as "/@:handle"; accept the handle with or without its "@"
  const params = useParams() as Record<string, string | undefined>;
  const handle = (params.handle ?? params[0] ?? '').replace(/^@/, '');

  const user = useApi<unknown>(handle ? `/api/users/${enc(handle)}` : null);
  const profile = unwrap<UserProfile>(user.data, 'user');
  // handles are case-insensitive; use the canonical spelling so these requests share the gallery's cache entries
  const canonical = profile?.handle ?? null;
  const themes = useApi<{ themes: ThemeSummary[] }>(canonical ? `/api/themes?owner=${enc(canonical)}` : null);
  const { photos } = usePhotoList(canonical ? `owner=${enc(canonical)}` : null);

  useDocTitle(profile ? `${profile.displayName} @${profile.handle}` : null);
  useScrollTop(handle);

  if (user.error) {
    return (
      <main className="page bw">
        <LoadError
          error={user.error}
          onRetry={user.reload}
          notFound={{ title: '没有这位用户', hint: `找不到 @${handle}。`, back: { href: '/', label: '回到图库' } }}
        />
      </main>
    );
  }
  if (!profile) {
    return (
      <main className="page bw">
        <Loading />
      </main>
    );
  }

  const avatar = profile.avatarPhotoId ? photos?.find((p) => p.id === profile.avatarPhotoId) : undefined;
  const themeList = themes.data?.themes ?? [];

  return (
    <main className="page bw">
      <header className="prof-head">
        {avatar && <Img photo={avatar} ratio="1 / 1" sizes="96px" alt="" className="prof-avatar" />}
        <div className="prof-id">
          <h1 className="display display-m prof-name">{profile.displayName}</h1>
          <p className="prof-handle mono">@{profile.handle}</p>
          {profile.bio && <p className="prof-bio">{profile.bio}</p>}
        </div>
        <p className="prof-counts">
          <span>
            <span className="prof-num">{profile.photoCount}</span>
            <span className="prof-unit">张</span>
          </span>
          <span>
            <span className="prof-num">{profile.themeCount}</span>
            <span className="prof-unit">个主题</span>
          </span>
        </p>
      </header>

      {themeList.length > 0 && (
        <section className="prof-themes" aria-label="主题">
          <ul>
            {themeList.map((t) => (
              <li key={t.id}>
                <Link href={`/t/${t.id}`} className="prof-theme">
                  {t.cover ? (
                    <Img photo={t.cover} ratio="3 / 2" sizes="280px" alt="" />
                  ) : (
                    <span className="prof-theme-blank" aria-hidden="true" />
                  )}
                  <span className="prof-theme-title">{t.title}</span>
                  <span className="prof-theme-meta">
                    {themeMeta(t)}
                    {VISIBILITY[t.visibility] && <em>{VISIBILITY[t.visibility]}</em>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Gallery owner={profile.handle} />
    </main>
  );
}
