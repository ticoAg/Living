import type { ReactNode } from 'react';
import { Link, Router, useLocation, useSearch, type AroundNavHandler } from 'wouter';
import { AsVisitor } from '../lib/session';
import { VisitorContext, withoutVisitor, withVisitor } from '../lib/visitor';

const hrefs = (href: string) => withVisitor(href);
const aroundNav: AroundNavHandler = (navigate, to, options) => navigate(withVisitor(to), options);

/** The pages inside as a visitor sees them, under a bar that says so and leads back out (lib/visitor.ts). */
export default function VisitorView({ children }: { children: ReactNode }) {
  const [path] = useLocation();
  const search = useSearch();
  return (
    <VisitorContext.Provider value>
      <div className="vv-bar" role="status">
        <span>访客看到的样子</span>
        {/* outside the router below, so this link leaves the view */}
        <Link href={withoutVisitor(`${path}?${search}`)} className="vv-exit">
          退出
        </Link>
      </div>
      <AsVisitor>
        <Router hrefs={hrefs} aroundNav={aroundNav}>
          {children}
        </Router>
      </AsVisitor>
    </VisitorContext.Provider>
  );
}
