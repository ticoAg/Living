import { Link } from 'wouter';
import { withVisitor } from '../lib/visitor';
import { Icon } from './icons';

/** For the author: this page as a visitor sees it (lib/visitor.ts). */
export default function VisitorLink({ href, iconSize = 16 }: { href: string; iconSize?: number }) {
  return (
    <Link href={withVisitor(href)} className="btn btn-quiet">
      <Icon name="eye" size={iconSize} />
      访客视角
    </Link>
  );
}
