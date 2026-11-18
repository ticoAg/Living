import { lazy, type ComponentType } from 'react';
import { dayOf, monthSpan, parseMonth } from '../shared/days';
import { prefetch, visitorKey } from './lib/useApi';
import { isVisitorSearch } from './lib/visitor';

// Page modules are split per route. Without help each first visit waits for its chunk, then for its data,
// with the Suspense fallback in between. Two things close that gap:
// - when the browser is idle after the first page, the browse/themes/living chunks are fetched in the background;
// - pointing at, touching or focusing an in-app link fetches that route's chunk and the GET requests its page makes,
//   so they are usually in the shared cache by the time the click lands.

type Loader = () => Promise<{ default: ComponentType }>;
type Page = ReturnType<typeof lazy<ComponentType>> & { preload: () => void };

// The preload and React.lazy share one request. A failed preload is forgotten, so rendering the page later asks
// again. A failure while rendering is final for this tab: React.lazy keeps rethrowing the error it got, and the
// chunk is usually gone for good (a deploy replaced it). ErrorBoundary and lib/chunks.ts recover from that with a
// full page load, which fetches the new build.
function page(load: Loader): Page {
  let pending: Promise<{ default: ComponentType }> | undefined;
  const get = () =>
    (pending ??= load().catch((e: unknown) => {
      pending = undefined;
      throw e;
    }));
  return Object.assign(lazy(get), { preload: () => void get().catch(() => {}) });
}

export const Today = page(() => import('./pages/Today'));
export const Archive = page(() => import('./pages/Archive'));
export const Calendar = page(() => import('./pages/Calendar'));
export const YearReview = page(() => import('./pages/YearReview'));
export const EntryReader = page(() => import('./pages/EntryReader'));
export const EntryEditor = page(() => import('./pages/EntryEditor'));
export const Projects = page(() => import('./pages/Projects'));
export const ProjectPage = page(() => import('./pages/ProjectPage'));
export const ProjectForm = page(() => import('./pages/ProjectForm'));
export const Explore = page(() => import('./pages/Explore'));
export const Profile = page(() => import('./pages/Profile'));
export const Works = page(() => import('./pages/Works'));
export const Articles = page(() => import('./pages/Articles'));
export const Photo = page(() => import('./pages/Photo'));
export const Place = page(() => import('./pages/Place'));
export const MapPage = page(() => import('./pages/MapPage'));
export const IndexPage = page(() => import('./pages/IndexPage'));
export const Living = page(() => import('./pages/Living'));
export const Upload = page(() => import('./pages/Upload'));
export const PhotoEdit = page(() => import('./pages/PhotoEdit'));
export const PlaceEdit = page(() => import('./pages/PlaceEdit'));
export const TagsManager = page(() => import('./pages/TagsManager'));
export const Login = page(() => import('./pages/Login'));
export const Register = page(() => import('./pages/Register'));
export const Settings = page(() => import('./pages/Settings'));
export const Themes = page(() => import('./pages/Themes'));
export const ThemeReader = page(() => import('./pages/ThemeReader'));
export const ThemeEditor = page(() => import('./pages/ThemeEditor'));
export const ShareOpen = page(() => import('./pages/ShareOpen'));
export const Search = page(() => import('./pages/Search'));
export const NotFound = page(() => import('./pages/NotFound'));

const enc = encodeURIComponent;
const dec = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

// The gallery, map and index all read the same three lists.
const BROWSE = ['/api/photos', '/api/tags', '/api/pois'];
// Today and the archive read the author's own entries and photos.
const ARCHIVE = ['/api/entries?mine=1', '/api/photos?mine=1', '/api/tags'];

/** The page for a path and the GET paths it requests on mount, spelled exactly as the page spells them. */
const TABLE: [RegExp, Page, (m: string[]) => string[]][] = [
  [/^\/$/, Explore, () => BROWSE],
  [/^\/today$/, Today, () => ARCHIVE],
  [/^\/archive$/, Archive, () => ARCHIVE],
  [/^\/archive\/calendar$/, Calendar, () => []],
  [/^\/archive\/(\d{4})$/, YearReview, (m) => [`/api/review/${m[1]}`, '/api/review']],
  [/^\/entries\/new$/, EntryEditor, () => []],
  [/^\/e\/([^/]+)\/edit$/, EntryEditor, (m) => [`/api/entries/${enc(dec(m[1]))}`]],
  [/^\/e\/([^/]+)$/, EntryReader, (m) => [`/api/entries/${enc(dec(m[1]))}`]],
  [/^\/projects$/, Projects, () => ['/api/projects?mine=1']],
  [/^\/projects\/new$/, ProjectForm, () => []],
  [/^\/projects\/([^/]+)\/edit$/, ProjectForm, (m) => [`/api/projects/${enc(dec(m[1]))}`]],
  [/^\/projects\/([^/]+)$/, ProjectPage, (m) => [`/api/projects/${enc(dec(m[1]))}`, `/api/entries?project=${enc(dec(m[1]))}`]],
  [/^\/(?:@|%40)([^/]+)\/?$/i, Profile, (m) => [`/api/users/${enc(dec(m[1]))}`]],
  // the lists are asked for by the canonical handle, which links write
  [/^\/(?:@|%40)([^/]+)\/works\/?$/i, Works, (m) => [`/api/users/${enc(dec(m[1]))}`, `/api/entries?owner=${enc(dec(m[1]))}&type=creation`]],
  [
    /^\/(?:@|%40)([^/]+)\/articles\/?$/i,
    Articles,
    (m) => [`/api/users/${enc(dec(m[1]))}`, `/api/entries?owner=${enc(dec(m[1]))}&type=article`]
  ],
  [/^\/p\/([^/]+)$/, Photo, (m) => [`/api/photos/${enc(dec(m[1]))}`, '/api/photos']],
  [
    /^\/place\/([^/]+)$/,
    Place,
    (m) => [`/api/pois/${enc(dec(m[1]))}`, `/api/photos?poi=${enc(dec(m[1]))}`, '/api/tags', `/api/entries?poi=${enc(dec(m[1]))}`]
  ],
  [/^\/map$/, MapPage, () => BROWSE],
  [/^\/index$/, IndexPage, () => BROWSE],
  [/^\/living$/, Living, () => []],
  [/^\/upload$/, Upload, () => []],
  [/^\/studio\/photo\/[^/]+$/, PhotoEdit, () => []],
  [/^\/studio\/place\/[^/]+$/, PlaceEdit, () => []],
  [/^\/studio\/tags$/, TagsManager, () => []],
  [/^\/login$/, Login, () => []],
  [/^\/register$/, Register, () => []],
  [/^\/settings$/, Settings, () => []],
  [/^\/themes$/, Themes, () => []],
  [/^\/themes\/new$/, ThemeEditor, () => []],
  [/^\/t\/[^/]+\/edit$/, ThemeEditor, () => []],
  [/^\/t\/([^/]+)$/, ThemeReader, (m) => [`/api/themes/${enc(dec(m[1]))}`]],
  [/^\/s\/[^/]+$/, ShareOpen, () => []],
  [/^\/search$/, Search, () => []]
];

/** Fetch the chunk for `url` and, with `data`, the GET requests its page will make. */
export function warm(url: URL, data: boolean): void {
  for (const [re, pg, paths] of TABLE) {
    const m = re.exec(url.pathname);
    if (!m) continue;
    pg.preload();
    if (data) {
      const list = paths(m);
      // the theme list depends on ?mine=1 and the session, so only the public list is warmed
      if (pg === Themes && !url.search.includes('mine=1')) list.push('/api/themes');
      // the calendar reads the month in its address, this one by default
      if (pg === Calendar) {
        const now = new Date();
        const { from, to } = monthSpan(
          parseMonth(url.searchParams.get('month')) ?? dayOf(now.getFullYear(), now.getMonth() + 1, 1).slice(0, 7)
        );
        list.push(`/api/entries?mine=1&from=${from}&to=${to}`, `/api/photos?mine=1&from=${from}&to=${to}`, '/api/tags');
      }
      // in the visitor view (lib/visitor.ts) the page asks as a visitor
      const visitor = isVisitorSearch(url.search);
      list.forEach((p) => prefetch(visitor ? visitorKey(p) : p));
    }
    return;
  }
}

/** Chunks worth having before anyone asks: the pages one click away from the gallery, and from Today and the archive. */
const IDLE = [
  Explore,
  Photo,
  Place,
  Profile,
  MapPage,
  IndexPage,
  Themes,
  ThemeReader,
  Living,
  Today,
  Archive,
  Calendar,
  YearReview,
  EntryReader,
  Projects,
  ProjectPage
];

function slowNetwork(): boolean {
  const c = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return !!c && (!!c.saveData || /(^|-)2g$/.test(c.effectiveType ?? ''));
}

function linkUrl(target: EventTarget | null): URL | null {
  const a = (target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
  if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return null;
  const url = new URL(a.href, location.href);
  return url.origin === location.origin && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/media/') ? url : null;
}

/** Install the idle prefetch and the link-intent listeners. Call once at startup. */
export function startWarming(): void {
  // Hovering only counts after a short pause, so sweeping the pointer across a grid of photos stays quiet.
  let hover: ReturnType<typeof setTimeout> | undefined;
  document.addEventListener('pointerover', (e) => {
    const url = linkUrl(e.target);
    if (!url || e.pointerType !== 'mouse') return;
    clearTimeout(hover);
    hover = setTimeout(() => warm(url, true), 80);
  });
  document.addEventListener('pointerout', () => clearTimeout(hover));
  // A press or keyboard focus means the click is coming.
  const now = (e: Event) => {
    const url = linkUrl(e.target);
    if (url) warm(url, true);
  };
  document.addEventListener('pointerdown', now, { passive: true });
  document.addEventListener('focusin', now);

  if (slowNetwork()) return;
  const idle = (fn: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 4000 }) : setTimeout(fn, 1500));
  // one chunk per idle slot, so the background work never competes with the page in front
  let i = 0;
  const next = () => {
    if (i >= IDLE.length) return;
    IDLE[i++].preload();
    idle(next);
  };
  // wait for the first page to settle (its own images included) before starting
  if (document.readyState === 'complete') idle(next);
  else window.addEventListener('load', () => idle(next), { once: true });
}
