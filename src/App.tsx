import { Suspense } from 'react';
import { Route, Switch, useLocation } from 'wouter';
import ErrorBoundary from './components/ErrorBoundary';
import Header from './components/Header';
import ReLogin from './components/ReLogin';
import { SessionProvider } from './lib/session';
import {
  Explore,
  IndexPage,
  Living,
  Login,
  MapPage,
  NotFound,
  Photo,
  PhotoEdit,
  Place,
  PlaceEdit,
  Profile,
  Register,
  Settings,
  TagsManager,
  ThemeEditor,
  ThemeReader,
  Themes,
  Upload
} from './routes';

// Route table. Each page module is owned by one area (see /docs/architecture/frontend.md):
// browse — Explore, Profile, Photo, Place, MapPage, IndexPage
// living — Living
// studio — Upload, PhotoEdit, PlaceEdit, TagsManager, Login, Register, Settings
// themes — Themes, ThemeReader, ThemeEditor
// The lazy page modules and their prefetching live in ./routes.

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
      {/* the header stays outside: an error in a page (or its chunk) still leaves the navigation */}
      <ErrorBoundary resetKey={path}>
        {/* the fallback fades in late: a chunk that arrives quickly never flashes it */}
        <Suspense fallback={<p className="loading loading-late">加载中</p>}>
          <Routes />
        </Suspense>
      </ErrorBoundary>
      <ReLogin />
    </SessionProvider>
  );
}
