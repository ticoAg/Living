import { lazy, Suspense, type ComponentType } from 'react';
import { Route, Switch, useLocation } from 'wouter';
import Header from './components/Header';
import { SessionProvider } from './lib/session';

// Route table. Each page module is owned by one area (see /docs/architecture/frontend.md):
// browse — Explore, Profile, Photo, Place, MapPage, IndexPage
// living — Living
// studio — Upload, PhotoEdit, PlaceEdit, TagsManager, Login, Register, Settings
// themes — Themes, ThemeReader, ThemeEditor
const page = (load: () => Promise<{ default: ComponentType }>) => lazy(load);
const Explore = page(() => import('./pages/Explore'));
const Profile = page(() => import('./pages/Profile'));
const Photo = page(() => import('./pages/Photo'));
const Place = page(() => import('./pages/Place'));
const MapPage = page(() => import('./pages/MapPage'));
const IndexPage = page(() => import('./pages/IndexPage'));
const Living = page(() => import('./pages/Living'));
const Upload = page(() => import('./pages/Upload'));
const PhotoEdit = page(() => import('./pages/PhotoEdit'));
const PlaceEdit = page(() => import('./pages/PlaceEdit'));
const TagsManager = page(() => import('./pages/TagsManager'));
const Login = page(() => import('./pages/Login'));
const Register = page(() => import('./pages/Register'));
const Settings = page(() => import('./pages/Settings'));
const Themes = page(() => import('./pages/Themes'));
const ThemeReader = page(() => import('./pages/ThemeReader'));
const ThemeEditor = page(() => import('./pages/ThemeEditor'));
const NotFound = page(() => import('./pages/NotFound'));

function Routes() {
  return (
    <Switch>
      <Route path="/" component={Explore} />
      {/* wouter reads "@:handle" as a literal segment, and static assets redirect /@x to /%40x;
          a RegExp route captures the handle in either form */}
      <Route path={/^\/(?:@|%40)(?<handle>[^/]+)\/?$/i} component={Profile} />
      <Route path="/p/:id" component={Photo} />
      <Route path="/place/:id" component={Place} />
      <Route path="/map" component={MapPage} />
      <Route path="/index" component={IndexPage} />
      <Route path="/living" component={Living} />
      <Route path="/upload" component={Upload} />
      <Route path="/studio/photo/:id" component={PhotoEdit} />
      <Route path="/studio/place/:id" component={PlaceEdit} />
      <Route path="/studio/tags" component={TagsManager} />
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />
      <Route path="/settings" component={Settings} />
      <Route path="/themes" component={Themes} />
      <Route path="/themes/new" component={ThemeEditor} />
      <Route path="/t/:id/edit" component={ThemeEditor} />
      <Route path="/t/:id" component={ThemeReader} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  const [path] = useLocation();
  const immersive = path.startsWith('/living');
  return (
    <SessionProvider>
      {!immersive && <Header />}
      <Suspense fallback={<p className="loading">加载中</p>}>
        <Routes />
      </Suspense>
    </SessionProvider>
  );
}
