import { useParams } from 'wouter';
import type { UserProfile } from '../../shared/types';
import { enc, unwrap } from '../browse/api';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';

/** The person a page of /@handle/… is about: the handle as written, their profile once loaded, and whether it is the viewer. */
export function usePerson() {
  const params = useParams() as Record<string, string | undefined>;
  const handle = (params.handle ?? '').replace(/^@/, '');
  const r = useApi<unknown>(handle ? `/api/users/${enc(handle)}` : null);
  const profile = unwrap<UserProfile>(r.data, 'user');
  const { user } = useSession();
  const own = !!user && !!profile && user.handle.toLowerCase() === profile.handle.toLowerCase();
  return { handle, profile, error: r.error, reload: r.reload, own };
}
