import { Link } from 'wouter';
import type { UserProfile } from '../../shared/types';

/** The head of a works or articles page: whose they are, linking back to the profile, the title and how many. */
export default function ShowcaseHead({ profile, title, count }: { profile: UserProfile; title: string; count?: number }) {
  return (
    <header className="sc-head">
      <Link href={`/@${profile.handle}`} className="sc-who">
        {profile.displayName}
      </Link>
      {/* the count beside the heading, not in it: the page's name is the title alone */}
      <div className="sc-title">
        <h1 className="display display-m">{title}</h1>
        {count !== undefined && count > 0 && <span className="sc-count">{count}</span>}
      </div>
    </header>
  );
}
